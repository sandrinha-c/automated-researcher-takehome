"""Tests for controller.py using the scripted LLM and the fake evaluator.
No GPU, no API key, nothing written outside a temp folder.

    python -m unittest test_controller -v
"""
import hashlib
import os
import tempfile
import time
import unittest

import controller as c

OFFICIAL = os.path.join(c.TASK_DIR, "algorithm.py")
BASELINE_ACC = 0.1701


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def marker(action):
    return lambda code: c.with_marker(code, action)


class LoopCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.runs, self.state = os.path.join(tmp.name, "runs"), os.path.join(tmp.name, "loop")
        self.task_hashes = {n: sha(os.path.join(c.TASK_DIR, n)) for n in os.listdir(c.TASK_DIR)
                            if os.path.isfile(os.path.join(c.TASK_DIR, n))}

    def tearDown(self):  # the loop must never change the official task files
        for n, h in self.task_hashes.items():
            self.assertEqual(sha(os.path.join(c.TASK_DIR, n)), h, n)

    def loop(self, script, n=None, timeout_s=20, **kw):
        self.llm = c.ScriptedLLM(script)
        return c.run_loop(OFFICIAL, BASELINE_ACC, "baseline", self.llm, c.fake_runner_cmd,
                          self.runs, self.state, n or len(script), timeout_s, log=lambda s: None, **kw)

    def best(self):
        return c.read_text(os.path.join(self.state, "best", "algorithm.py"))

    def candidate(self, entry):
        return c.read_text(os.path.join(self.runs, entry["id"], "algorithm.py"))


class TestAcceptance(LoopCase):
    def test_strictly_greater_is_accepted_and_becomes_best(self):
        h = self.loop([("up", marker("acc=0.1850"))])
        self.assertEqual(h[1]["status"], "accepted")
        self.assertEqual((h[1]["best_before"], h[1]["best_after"], h[1]["best_id"]),
                         (BASELINE_ACC, 0.185, h[1]["id"]))
        self.assertEqual(self.best(), self.candidate(h[1]))

    def test_tie_and_worse_are_rejected(self):
        h = self.loop([("tie", marker(f"acc={BASELINE_ACC}")), ("down", marker("acc=0.1"))])
        self.assertEqual([r["status"] for r in h[1:]], ["rejected", "rejected"])
        self.assertEqual(h[-1]["best_id"], "baseline")
        self.assertEqual(self.best(), c.read_text(OFFICIAL))

    def test_evaluate_rule(self):
        self.assertTrue(c.evaluate(0.2, 0.1))
        self.assertFalse(c.evaluate(0.1, 0.1))
        self.assertFalse(c.evaluate(0.05, 0.1))

    def test_baseline_copy_is_byte_identical_even_after_an_accept(self):
        self.loop([("up", marker("acc=0.5"))])
        self.assertEqual(sha(os.path.join(self.state, "baseline", "algorithm.py")), sha(OFFICIAL))
        self.assertNotEqual(self.best(), c.read_text(OFFICIAL))

    def test_next_candidate_is_built_on_the_new_best(self):
        h = self.loop([("up", marker("acc=0.1850")), ("up again", marker("acc=0.1900"))])
        self.assertEqual(h[2]["parent"], h[1]["id"])
        diff = c.read_text(os.path.join(self.runs, h[2]["id"], "diff.patch"))
        self.assertIn("-# FAKE_RUN: acc=0.1850", diff)
        self.assertIn("+# FAKE_RUN: acc=0.1900", diff)


class TestFailures(LoopCase):
    def assert_failed(self, entry, status):
        self.assertEqual(entry["status"], status)
        self.assertIsNone(entry["val_acc"])
        self.assertEqual(entry["best_id"], "baseline")
        self.assertEqual(self.best(), c.read_text(OFFICIAL))

    def test_invalid_patch_syntax_error_is_not_run(self):
        h = self.loop([("bad", lambda code: code + "\ndef broken(:\n")])
        self.assert_failed(h[1], "invalid_patch")
        self.assertIn("SyntaxError", h[1]["error"])
        self.assertFalse(os.path.exists(os.path.join(self.runs, h[1]["id"], "stdout.log")))

    def test_invalid_patch_missing_function(self):
        h = self.loop([("bad", lambda code: code.replace("def get_augmentation", "def get_aug"))])
        self.assert_failed(h[1], "invalid_patch")
        self.assertIn("get_augmentation", h[1]["error"])

    def test_invalid_patch_reply_without_code(self):
        self.llm = lambda prompt: "HYPOTHESIS: I forgot the code"
        h = c.run_loop(OFFICIAL, BASELINE_ACC, "baseline", self.llm, c.fake_runner_cmd,
                       self.runs, self.state, 1, 20, log=lambda s: None)
        self.assert_failed(h[1], "invalid_patch")
        self.assertIn("no ```python code block", h[1]["error"])

    def test_crash(self):
        h = self.loop([("boom", marker("crash"))])
        self.assert_failed(h[1], "crash")
        self.assertIn("fake crash: CUDA out of memory", h[1]["error"])

    def test_missing_result_file_is_a_crash(self):
        cmd = lambda run_dir: [c.sys.executable, "-c", "print('exits 0 but writes nothing')"]
        h = c.run_loop(OFFICIAL, BASELINE_ACC, "baseline", c.ScriptedLLM([("x", marker("acc=0.9"))]),
                       cmd, self.runs, self.state, 1, 20, log=lambda s: None)
        self.assert_failed(h[1], "crash")

    def test_timeout_kills_the_process(self):
        t0 = time.time()
        h = self.loop([("hang", marker("sleep=60"))], timeout_s=2)
        self.assert_failed(h[1], "timeout")
        self.assertLess(time.time() - t0, 30)

    def test_loop_continues_after_failures_and_feeds_errors_back(self):
        h = self.loop([("bad", lambda code: code + "\ndef broken(:\n"), ("boom", marker("crash")),
                       ("up", marker("acc=0.1850"))])
        self.assertEqual([r["status"] for r in h], ["baseline", "invalid_patch", "crash", "accepted"])
        self.assertIn("SyntaxError", self.llm.prompts[1])           # seen by the 2nd proposal
        self.assertIn("fake crash: CUDA out of memory", self.llm.prompts[2])  # and by the 3rd


class TestBookkeeping(LoopCase):
    def test_max_experiments_caps_llm_calls(self):
        h = self.loop(c.FAKE_SCRIPT[:1] * 9, n=4)
        self.assertEqual(len(h), 1 + 4)
        self.assertEqual(len(self.llm.prompts), 4)

    def test_log_file_matches_history_and_resume_keeps_best(self):
        h1 = self.loop([("up", marker("acc=0.1850")), ("down", marker("acc=0.1"))])
        self.assertEqual(c.load_history(os.path.join(self.state, "runs.jsonl")), h1)
        os.remove(os.path.join(self.state, "best", "algorithm.py"))  # e.g. interrupted mid-write
        h2 = self.loop([("tie", marker("acc=0.1850"))], n=3)  # resume: 2 done, 1 more allowed
        self.assertEqual(len(self.llm.prompts), 1)
        self.assertEqual([r["status"] for r in h2], ["baseline", "accepted", "rejected", "rejected"])
        self.assertEqual(h2[3]["parent"], h1[1]["id"])
        self.assertEqual(self.best(), self.candidate(h1[1]))

    def test_run_dir_has_official_evaluator_copies_and_data_link(self):
        data = os.path.join(os.path.dirname(self.runs), "shared_data")
        os.makedirs(data)
        open(os.path.join(data, "cifar.bin"), "w").close()
        h = self.loop([("up", marker("acc=0.1850"))], data_dir=data)
        run_dir = os.path.join(self.runs, h[1]["id"])
        for name in c.PROTECTED_FILES:
            self.assertEqual(sha(os.path.join(run_dir, name)), sha(os.path.join(c.TASK_DIR, name)))
        self.assertTrue(os.path.exists(os.path.join(run_dir, "data", "cifar.bin")))
        os.rmdir(os.path.join(run_dir, "data")) if os.name == "nt" else os.unlink(os.path.join(run_dir, "data"))
        self.assertTrue(os.path.exists(os.path.join(data, "cifar.bin")))  # removing the link keeps the data

    def test_run_numbers_continue_after_existing_runs(self):
        os.makedirs(os.path.join(self.runs, "006_det_s44"))
        h = self.loop([("up", marker("acc=0.1850"))])
        self.assertEqual(h[1]["id"], "007_loop")


class TestStatic(unittest.TestCase):
    def test_official_algorithm_is_valid(self):
        self.assertIsNone(c.validate(c.read_text(OFFICIAL)))

    def test_real_runner_command_targets_local_eval(self):
        cmd = c.real_runner_cmd("some_dir")
        self.assertEqual(cmd[1:], [c.LOCAL_EVAL, "--workdir", "some_dir"])

    def test_prompt_shows_best_code_score_and_history(self):
        hist = [{"id": "007_loop", "status": "crash", "val_acc": None, "hypothesis": "bigger lr",
                 "error": "line1\nRuntimeError: nan loss"}]
        prompt = c.build_prompt("x = 1\n", 0.1701, hist)
        for text in ("x = 1", "0.1701", "007_loop [crash]", "bigger lr", "RuntimeError: nan loss"):
            self.assertIn(text, prompt)


if __name__ == "__main__":
    unittest.main()
