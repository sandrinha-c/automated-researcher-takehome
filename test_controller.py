"""Tests for controller.py using the scripted LLM and the fake evaluator.
No GPU, no LLM call, nothing written outside a temp folder.

    python -m unittest test_controller -v
"""
import hashlib
import os
import tempfile
import time
import unittest
from unittest import mock

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
        self.assertEqual(h[1]["llm"], {"model": "scripted-fake"})
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

    def test_invalid_patch_reason_reaches_the_next_proposal(self):
        self.loop([("bad", lambda code: code + "\nimport os\n"), ("up", marker("acc=0.1850"))])
        self.assertIn("import of 'os' is not allowed", self.llm.prompts[1])

    def test_invalid_patch_reply_without_code(self):
        self.llm = lambda prompt: "HYPOTHESIS: I forgot the code"
        h = c.run_loop(OFFICIAL, BASELINE_ACC, "baseline", self.llm, c.fake_runner_cmd,
                       self.runs, self.state, 1, 20, log=lambda s: None)
        self.assert_failed(h[1], "invalid_patch")
        self.assertIn("no ```python code block", h[1]["error"])

    def test_llm_failure_is_recorded_and_the_loop_continues(self):
        good = c.ScriptedLLM([("up", marker("acc=0.1850"))])
        calls = []

        def flaky(prompt):
            calls.append(prompt)
            if len(calls) == 1:
                raise c.LLMError("claude gave no answer within 600s")
            return good(prompt)

        h = c.run_loop(OFFICIAL, BASELINE_ACC, "baseline", flaky, c.fake_runner_cmd,
                       self.runs, self.state, 2, 20, log=lambda s: None)
        self.assertEqual([r["status"] for r in h[1:]], ["llm_error", "accepted"])
        self.assertIn("no answer", h[1]["error"])
        self.assertTrue(os.path.exists(os.path.join(self.runs, h[1]["id"], "prompt.txt")))
        self.assertNotIn("llm_error", calls[1])  # not the LLM's fault, so not fed back

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


class TestDuplicatesAndFeedback(LoopCase):
    def test_code_that_already_has_a_score_is_not_run_again(self):
        h = self.loop([("same as the baseline", lambda code: code),
                       ("up", marker("acc=0.1850")), ("same as the best", lambda code: code)])
        self.assertEqual([r["status"] for r in h[1:]], ["invalid_patch", "accepted", "invalid_patch"])
        self.assertIn("identical to the code of baseline", h[1]["error"])
        self.assertIn(f"identical to the code of {h[2]['id']}", h[3]["error"])
        for i in (1, 3):
            self.assertFalse(os.path.exists(os.path.join(self.runs, h[i]["id"], "stdout.log")))
        self.assertIn("identical to the code of baseline", self.llm.prompts[1])  # fed back

    def test_duplicates_are_still_refused_after_a_restart(self):
        h1 = self.loop([("down", marker("acc=0.1"))])
        h2 = self.loop([("down again", marker("acc=0.1"))], n=2)
        self.assertEqual(h2[2]["status"], "invalid_patch")
        self.assertIn(h1[1]["id"], h2[2]["error"])

    def test_pretrain_loss_is_recorded_and_shown_to_the_next_proposal(self):
        script = ("import json, os, sys; d = sys.argv[1]; "
                  "print('Pretrain Epoch 1/20: Loss=1696.6095'); print('Pretrain Epoch 20/20: Loss=nan'); "
                  "json.dump({'val_acc': 0.01}, open(os.path.join(d, 'local_eval.json'), 'w'))")
        cmd = lambda run_dir: [c.sys.executable, "-c", script, run_dir]
        self.llm = c.ScriptedLLM([("diverges", marker("acc=0.5")), ("next", marker("acc=0.6"))])
        h = c.run_loop(OFFICIAL, BASELINE_ACC, "baseline", self.llm, cmd,
                       self.runs, self.state, 2, 20, log=lambda s: None)
        self.assertEqual((h[1]["status"], h[1]["pretrain_loss"]), ("rejected", "1696.6095 -> nan"))
        self.assertIn("pretrain_loss=1696.6095 -> nan", self.llm.prompts[1])

    def test_half_written_last_log_line_does_not_block_a_restart(self):
        h1 = self.loop([("up", marker("acc=0.1850"))])
        with open(os.path.join(self.state, "runs.jsonl"), "a", encoding="utf-8") as f:
            f.write('{"id": "008_loop", "status": "rej')
        h2 = self.loop([("up again", marker("acc=0.1900"))], n=2)
        self.assertEqual(h2[1], h1[1])
        self.assertEqual(h2[-1]["status"], "accepted")

    def test_stopping_the_controller_kills_the_running_experiment(self):
        proc = mock.Mock()
        proc.wait.side_effect = [KeyboardInterrupt, 0]
        os.makedirs(self.runs)
        with mock.patch.object(c.subprocess, "Popen", return_value=proc), \
                mock.patch.object(c, "kill_tree") as kill:
            with self.assertRaises(KeyboardInterrupt):
                c.run_experiment(self.runs, ["x"], 5)
        kill.assert_called_once_with(proc)


class TestSearch(LoopCase):
    """Multi-seed search: screen on the first seed, confirm on all, explore when stuck."""
    SEEDS = [42, 43, 44]

    def search(self, script, base=0.20, **kw):
        dirs = []
        for seed in self.SEEDS:
            d = os.path.join(self.runs, f"00{seed - 42}_base_s{seed}")
            if not os.path.exists(d):
                os.makedirs(d)
                c.shutil.copyfile(OFFICIAL, os.path.join(d, "algorithm.py"))
                c.write_text(os.path.join(d, "local_eval.json"), c.json.dumps({"val_acc": base, "seed": seed}))
            dirs.append(d)
        self.llm = c.ScriptedLLM(script)
        args = dict(seeds=self.SEEDS, max_runs=30, max_experiments=len(script), timeout_s=20, log=lambda s: None)
        args.update(kw)
        return c.run_search(dirs, self.llm, c.fake_runner_cmd, self.runs, self.state, **args)

    def test_screen_rule(self):
        self.assertTrue(c.screen(0.20, 0.20, 0.01))
        self.assertTrue(c.screen(0.191, 0.20, 0.01))   # a narrow loss may be bad luck
        self.assertFalse(c.screen(0.18, 0.20, 0.01))

    def test_clear_loss_on_the_first_seed_costs_one_run(self):
        h, _ = self.search([("worse", marker("acc=0.15"), "loss")])
        self.assertEqual((h[1]["status"], h[1]["scores"], h[1]["val_acc"], h[1]["runs_used"]),
                         ("screened_out", {"42": 0.15}, None, 1))
        self.assertFalse(os.path.exists(os.path.join(self.runs, h[1]["id"], "s43")))
        self.assertEqual(h[1]["best_id"], h[0]["id"])

    def test_lucky_first_seed_is_rejected_on_the_mean(self):
        h, _ = self.search([("lucky", marker("acc=42:0.24,43:0.15,44:0.15"), "loss")])
        self.assertEqual((h[1]["status"], h[1]["runs_used"]), ("rejected", 3))
        self.assertAlmostEqual(h[1]["val_acc"], 0.18)
        self.assertEqual(self.best(), c.read_text(OFFICIAL))

    def test_narrow_loss_on_the_first_seed_can_still_win_on_the_mean(self):
        h, _ = self.search([("unlucky", marker("acc=42:0.195,43:0.23,44:0.22"), "loss")])
        self.assertEqual(h[1]["status"], "accepted")
        self.assertEqual((h[1]["best_id"], h[1]["best_after"]), (h[1]["id"], h[1]["val_acc"]))
        self.assertEqual(self.best(), self.candidate(h[1]))
        for seed in self.SEEDS:  # each seed ran in its own folder with official evaluator copies
            self.assertEqual(c.protected_files_changed(os.path.join(self.runs, h[1]["id"], f"s{seed}")), [])

    def test_equal_mean_is_rejected(self):
        h, _ = self.search([("tie", marker("acc=0.20"), "loss")])
        self.assertEqual(h[1]["status"], "rejected")

    def test_next_candidate_is_compared_with_the_new_best_per_seed(self):
        h, _ = self.search([("up", marker("acc=0.25"), "loss"), ("between", marker("acc=0.22"), "loss")])
        self.assertEqual([r["status"] for r in h[1:]], ["accepted", "screened_out"])
        self.assertEqual(h[2]["parent"], h[1]["id"])

    def test_crash_on_a_later_seed_keeps_the_best_and_the_partial_scores(self):
        h, _ = self.search([("boom", marker("crash@43"), "loss")])
        self.assertEqual((h[1]["status"], h[1]["scores"], h[1]["runs_used"]), ("crash", {"42": 0.21}, 2))
        self.assertIn("seed 43", h[1]["error"])
        self.assertEqual(h[1]["best_id"], h[0]["id"])

    def test_explore_rule_refuses_the_category_of_the_last_failure(self):
        h, _ = self.search([("a", marker("acc=0.15"), "augmentation"), ("b", marker("acc=0.16"), "augmentation"),
                            ("c", marker("acc=0.30"), "augmentation"), ("d", marker("acc=0.30"), "loss"),
                            ("e", marker("acc=0.31"), "loss")])
        self.assertEqual([r["status"] for r in h[1:]],
                         ["screened_out", "screened_out", "invalid_patch", "accepted", "accepted"])
        self.assertIn("explore rule", h[3]["error"])
        self.assertFalse(os.path.exists(os.path.join(self.runs, h[3]["id"], "s42")))  # refused before any run
        self.assertNotIn("EXPLORE:", self.llm.prompts[1])
        self.assertIn("must NOT be in category 'augmentation'", self.llm.prompts[2])
        self.assertIn("explore rule", self.llm.prompts[3])       # the refusal is fed back
        self.assertNotIn("EXPLORE:", self.llm.prompts[4])       # an accept ends the explore phase

    def test_explore_every_assigns_the_least_trained_category_to_every_second_trained_candidate(self):
        h, _ = self.search([("a", marker("acc=0.15"), "optimisation"),     # free
                            ("b", marker("acc=0.30"), "optimisation"),     # assigned augmentation: refused
                            ("c", marker("acc=0.16"), "augmentation"),     # assigned augmentation: trained
                            ("d", marker("acc=0.17"), "augmentation"),     # free; the old rule would refuse it
                            ("e", marker("acc=0.30"), "loss")],            # assigned loss
                           explore_every=2)
        self.assertEqual([r["status"] for r in h[1:]],
                         ["screened_out", "invalid_patch", "screened_out", "screened_out", "accepted"])
        self.assertEqual([r["task"] for r in h[1:]],
                         [{"kind": "free", "category": None}, {"kind": "assigned", "category": "augmentation"},
                          {"kind": "assigned", "category": "augmentation"}, {"kind": "free", "category": None},
                          {"kind": "assigned", "category": "loss"}])
        self.assertIn("assigned category", h[2]["error"])
        self.assertFalse(os.path.exists(os.path.join(self.runs, h[2]["id"], "s42")))  # refused before any run
        self.assertEqual([r["runs_used"] for r in h[1:]], [1, 1, 2, 3, 6])            # a refusal costs no run
        self.assertNotIn("ASSIGNED CATEGORY", self.llm.prompts[0])
        self.assertIn("must be in category 'augmentation'", self.llm.prompts[1])
        self.assertIn("must be in category 'augmentation'", self.llm.prompts[2])      # still owed after the refusal
        self.assertIn("assigned category", self.llm.prompts[2])                       # the refusal is fed back
        self.assertNotIn("ASSIGNED CATEGORY", self.llm.prompts[3])
        self.assertIn("must be in category 'loss'", self.llm.prompts[4])
        self.assertFalse(any("EXPLORE:" in p for p in self.llm.prompts))              # explore-when-stuck is off
        self.assertFalse(any(r["explore"] for r in h[1:]))

    def test_assigned_category_counts_only_trained_candidates_and_breaks_ties_in_fixed_order(self):
        run = lambda cat, seconds=1.0: {"category": cat, "seconds": seconds}
        base = {"category": None, "seconds": None}
        self.assertIsNone(c.assigned_category([base, run("loss")], 0))                # option off
        self.assertIsNone(c.assigned_category([base], 2))                             # 1st of each pair is free
        self.assertEqual(c.assigned_category([base, run("other")], 2), "augmentation")
        self.assertEqual(c.assigned_category([base, run("augmentation")], 2), "loss")
        self.assertIsNone(c.assigned_category([base, run("augmentation"), run("loss")], 2))
        self.assertEqual(c.assigned_category([base, run("augmentation"), run("loss"), run("optimisation")], 2),
                         "architecture")
        h = [base, run("augmentation"), run("augmentation", None), run("loss", None)]  # two never trained
        self.assertEqual(c.assigned_category(h, 2), "loss")
        self.assertEqual(c.assigned_category([base, run("loss"), run("loss")], 3), "augmentation")
        self.assertEqual(c.assigned_category([base], 1), "augmentation")              # N=1: always assigned

    def test_without_explore_every_the_prompt_and_the_record_are_unchanged(self):
        h, _ = self.search([("a", marker("acc=0.15"), "loss")])
        self.assertNotIn("task", h[1])
        self.assertNotIn("ASSIGNED CATEGORY", self.llm.prompts[0])
        args = (c.read_text(OFFICIAL), h[:1], self.SEEDS, 0.01, 0, 2, 20)
        self.assertEqual(c.build_search_prompt(*args), c.build_search_prompt(*args, None, 0))
        self.assertEqual(self.llm.prompts[0], c.build_search_prompt(*args))

    def test_patience_stops_the_search(self):
        script = [(f"w{i}", marker(f"acc=0.1{i}"), c.CATEGORIES[i % 2]) for i in range(8)]
        h, reason = self.search(script, patience=3)
        self.assertEqual(len(h) - 1, 3)
        self.assertIn("patience 3", reason)

    def test_run_budget_stops_before_a_candidate_it_could_not_confirm(self):
        script = [(f"up{i}", marker(f"acc=0.3{i}"), "loss") for i in range(5)]
        h, reason = self.search(script, max_runs=7)
        self.assertEqual((len(h) - 1, h[-1]["runs_used"]), (2, 6))
        self.assertIn("run budget", reason)

    def test_three_failed_llm_calls_stop_the_search(self):
        def broken(prompt):
            raise c.LLMError("not logged in")
        dirs = self.search([("x", marker("acc=0.3"), "loss")], max_experiments=0)[0]  # creates the state
        h, reason = c.run_search([], broken, c.fake_runner_cmd, self.runs, self.state, seeds=self.SEEDS,
                                 max_runs=30, max_experiments=20, timeout_s=20, log=lambda s: None)
        self.assertEqual([r["status"] for r in h[1:]], ["llm_error"] * 3)
        self.assertIn("LLM calls", reason)

    def test_resume_keeps_best_budget_and_duplicates(self):
        h1, _ = self.search([("up", marker("acc=0.25"), "loss")])
        os.remove(os.path.join(self.state, "best", "algorithm.py"))
        h2, _ = self.search([("same again", lambda code: code, "loss"), ("down", marker("acc=0.1"), "loss")],
                            max_experiments=3)
        self.assertEqual([r["status"] for r in h2[1:]], ["accepted", "invalid_patch", "screened_out"])
        self.assertIn("identical to the code of", h2[2]["error"])
        self.assertEqual((h2[3]["runs_used"], h2[3]["best_id"]), (4, h1[1]["id"]))
        self.assertEqual(self.best(), self.candidate(h1[1]))

    def test_prompt_shows_seed_scores_noise_changes_and_diagnostics(self):
        script = ("import json, os, sys; d = sys.argv[1]; "
                  "json.dump({'val_acc': 0.15, 'loss_curve': [9.5, 3.25], "
                  "'features': {'finite': True, 'dim': 512, 'effective_rank': 12.3, 'mean_std': 0.5}}, "
                  "open(os.path.join(d, 'local_eval.json'), 'w'))")
        cmd = lambda workdir, seed: [c.sys.executable, "-c", script, workdir]
        self.search([], max_experiments=0)
        self.llm = c.ScriptedLLM([("first", lambda code: code.replace("lr': 0.4", "lr': 0.2"), "optimisation"),
                                  ("second", marker("acc=0.3"), "loss")])
        h, _ = c.run_search([], self.llm, cmd, self.runs, self.state, seeds=self.SEEDS, max_runs=30,
                            max_experiments=2, timeout_s=20, log=lambda s: None)
        self.assertEqual([list(x) for x in h[1]["changes"]], [["-", "'lr': 0.4,"], ["+", "'lr': 0.2,"]])
        prompt = self.llm.prompts[1]
        for text in ("seed 42=15.00", "[screened_out] category=optimisation basis=known",
                     "- 'lr': 0.4,", "+ 'lr': 0.2,", "pretrain loss per epoch (first seed): 9.5 3.25",
                     "effective rank 12.3 of 512", "optimisation: 1 tried / 0 accepted",
                     "is within noise", "must be picklable", "CATEGORY: <one of:"):
            self.assertIn(text, prompt)

    def test_baseline_runs_must_be_one_code_and_cover_the_seeds(self):
        os.makedirs(self.runs)
        d = os.path.join(self.runs, "000_base_s42")
        os.makedirs(d)
        c.shutil.copyfile(OFFICIAL, os.path.join(d, "algorithm.py"))
        c.write_text(os.path.join(d, "local_eval.json"), c.json.dumps({"val_acc": 0.2, "seed": 42}))
        with self.assertRaises(SystemExit):
            c.run_search([d], c.ScriptedLLM([]), c.fake_runner_cmd, self.runs, self.state, seeds=self.SEEDS,
                         max_runs=3, max_experiments=1, timeout_s=20, log=lambda s: None)

    def test_category_and_basis_are_parsed_from_the_reply(self):
        reply = "HYPOTHESIS: h\nCATEGORY: Loss\nBASIS: results - used 012_loop\n```python\nx = 1\n```\n"
        p = c.propose("prompt", lambda prompt: reply)
        self.assertEqual((p["category"], p["basis"], p["code"]), ("loss", "results - used 012_loop", "x = 1\n"))
        p = c.propose("prompt", lambda prompt: "HYPOTHESIS: h\nCATEGORY: banana\n```python\nx = 1\n```\n")
        self.assertEqual((p["category"], p["basis"]), ("other", None))

    def test_real_runner_command_passes_the_seed(self):
        self.assertEqual(c.real_runner_cmd("d", 43)[1:], [c.LOCAL_EVAL, "--workdir", "d", "--seed", "43"])


class TestBookkeeping(LoopCase):
    def test_max_experiments_caps_llm_calls(self):
        h = self.loop(c.FAKE_SCRIPT[:1] * 9, n=4)
        self.assertEqual(len(h), 1 + 4)
        self.assertEqual(len(self.llm.prompts), 4)

    def test_log_file_matches_history_and_resume_keeps_best(self):
        h1 = self.loop([("up", marker("acc=0.1850")), ("down", marker("acc=0.1"))])
        self.assertEqual(c.load_history(os.path.join(self.state, "runs.jsonl")), h1)
        os.remove(os.path.join(self.state, "best", "algorithm.py"))  # e.g. interrupted mid-write
        h2 = self.loop([("tie", lambda code: c.with_marker(code, "acc=0.1850") + "# other code\n")],
                       n=3)  # resume: 2 done, 1 more allowed
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


class FakeProc:
    """Stands in for the `claude` process so ClaudeCLI can be tested without calling it."""
    returncode = 0

    def __init__(self, stdout=b"", hang=False):
        self.stdout, self.hang, self.pid = stdout, hang, 0

    def communicate(self, data=None, timeout=None):
        self.stdin_data = data
        if self.hang:
            raise c.subprocess.TimeoutExpired("claude", timeout)
        return self.stdout, b"some stderr"


class TestClaudeCLI(unittest.TestCase):
    def call(self, proc):
        cli = c.ClaudeCLI("some-model", "medium")
        self.addCleanup(os.rmdir, cli.cwd)
        with mock.patch.object(c.subprocess, "Popen", return_value=proc) as popen, \
                mock.patch.object(c, "kill_tree") as self.kill:
            try:
                return cli, cli("the prompt")
            finally:
                self.cmd, self.kwargs = popen.call_args[0][0], popen.call_args[1]

    def test_success_returns_text_and_records_model_and_cost(self):
        out = {"result": "HYPOTHESIS: x", "is_error": False, "total_cost_usd": 0.12,
               "modelUsage": {"some-model": {}}}
        proc = FakeProc(c.json.dumps(out).encode())
        cli, reply = self.call(proc)
        self.assertEqual(reply, "HYPOTHESIS: x")
        self.assertEqual(proc.stdin_data, b"the prompt")
        self.assertEqual((cli.meta["model"], cli.meta["effort"], cli.meta["cost_usd"]),
                         ("some-model", "medium", 0.12))
        self.assertEqual(cli.meta["model_usage"], {"some-model": {}})
        self.assertEqual(self.cmd[self.cmd.index("--effort") + 1], "medium")
        self.assertEqual(self.cmd[-2:], ["--tools", ""])        # no tools: text only
        self.assertEqual(self.cmd[self.cmd.index("--model") + 1], "some-model")
        self.assertNotEqual(os.path.abspath(self.kwargs["cwd"]), c.ROOT)

    def test_error_output_and_timeout_raise_llm_error(self):
        for proc in (FakeProc(b"not json"), FakeProc(b'{"result": "limit reached", "is_error": true}'),
                     FakeProc(hang=True)):
            with self.assertRaises(c.LLMError):
                self.call(proc)
        self.kill.assert_called_once()


class TestValidate(unittest.TestCase):
    def setUp(self):
        self.official = c.read_text(OFFICIAL)

    def rejected(self, code, expect):
        reason = c.validate(code)
        self.assertIsNotNone(reason, "should have been rejected")
        self.assertIn(expect, reason)

    def test_official_algorithm_is_valid(self):
        self.assertIsNone(c.validate(self.official))

    def test_syntax_error(self):
        self.rejected(self.official + "\ndef broken(:\n", "SyntaxError")

    def test_each_required_name_is_checked(self):
        for name in c.REQUIRED_SYMBOLS:
            self.rejected(self.official.replace(name, name + "_x"), name)

    def test_alias_counts_as_defined(self):
        code = self.official.replace("class BarlowTwinsLoss", "class MyLoss") + "\nBarlowTwinsLoss = MyLoss\n"
        self.assertIsNone(c.validate(code))

    def test_each_required_model_attribute_is_checked(self):
        for attr in c.REQUIRED_MODEL_ATTRS:
            self.assertIn(f"self.{attr} =", self.official)
            self.rejected(self.official.replace(f"self.{attr} =", f"self.{attr}_x ="), f"self.{attr}")

    def test_evaluator_and_split_are_off_limits(self):
        for line, expect in [
            ("import os", "import of 'os'"),
            ("import json, sys", "import of 'json'"),
            ("from pathlib import Path", "import of 'pathlib'"),
            ("from . import train_eval_baseline", "relative import"),
            ("f = open('split_config.json', 'w')", "'open'"),
            ("NAME = 'split_' + 'config.json'; x = __builtins__", "__builtins__"),
            ("NAME = 'split_config.json'", "split_config"),
            ("NAME = 'train_eval_baseline.py'", "train_eval_baseline"),
            ("exec('import os')", "'exec'"),
            ("m = __import__('os')", "'__import__'"),
            ("x = torch.__dict__", "__dict__"),
            ("x = ().__class__.__bases__", "__bases__"),
            ("torch.save({}, 'x.pt')", "writes a file"),
            ("w = torch.load('model_checkpoint/backbone.pt')", "reads a file"),
            ("from torch import load", "reads a file"),
            ("np.save('x.npy', 0)", "writes a file"),
        ]:
            with self.subTest(line=line):
                self.rejected(self.official + "\n" + line + "\n", expect)

    def test_hidden_names_and_changes_to_libraries_are_off_limits(self):
        for line, expect in [
            ("d = getattr(torchvision, 'data' + 'sets')", "'getattr'"),
            ("setattr(torch.optim, 'SGD', torch.optim.AdamW)", "'setattr'"),
            ("torch.os.system('echo hi')", "operating system"),
            ("m = torch.sys.modules", "interpreter"),
            ("import numpy as np\nx = np.fromfile('data/cifar-100-python/test')", "reads a file"),
            ("torch.optim.SGD = torch.optim.AdamW", "assigning to 'torch...SGD'"),
            ("torch.utils.data.DataLoader.__init__ = None", "assigning to 'torch"),
            ("import numpy as np\nnp.random.RandomState = None", "assigning to 'np...RandomState'"),
            ("nn.Module.train = lambda self, mode=True: self", "assigning to 'nn...train'"),
        ]:
            with self.subTest(line=line):
                self.rejected(self.official + "\n" + line + "\n", expect)

    def test_changing_your_own_objects_is_allowed(self):
        extra = ("def build():\n"
                 "    net = models.resnet18(weights=None)\n"
                 "    net.fc = nn.Identity()\n"
                 "    net.layer4[0].conv1.stride = (1, 1)\n"
                 "    return net\n")
        self.assertIsNone(c.validate(self.official + "\n" + extra))

    def test_labels_downloads_and_seeds_are_off_limits(self):
        for line, expect in [
            ("d = torchvision.datasets.CIFAR100('./data', train=False)", "loads a dataset"),
            ("from torchvision import datasets", "loads a dataset"),
            ("import torchvision.datasets as D", "loads a dataset"),
            ("m = torch.hub.load('pytorch/vision', 'resnet18')", "downloads"),
            ("torch.manual_seed(0)", "changes the fixed seed"),
            ("random.seed(1)", "changes the fixed seed"),
            ("torch.backends.cudnn.benchmark = True", "deterministic"),
            ("torch.use_deterministic_algorithms(False)", "deterministic"),
        ]:
            with self.subTest(line=line):
                self.rejected(self.official + "\n" + line + "\n", expect)

    def test_ordinary_research_code_is_allowed(self):
        extra = (
            "import math, random\n"
            "import numpy as np\n"
            "import torch.nn.functional as F\n"
            "from torchvision.transforms import functional as TF\n"
            "class Solarize(nn.Module):\n"
            "    def __init__(self):\n"
            "        super().__init__()\n"
            "    def forward(self, x):\n"
            "        self.eval()\n"
            "        input = vars = x\n"
            "        return F.normalize(x, dim=-1) * math.sqrt(2.0)\n"
        )
        self.assertIsNone(c.validate(self.official + "\n" + extra))

    def test_reason_reports_line_numbers(self):
        n = len(self.official.splitlines()) + 3
        self.rejected(self.official + "\n\nimport os\n", f"line {n}:")


class TestIntegrityAfterRun(LoopCase):
    def test_changed_split_file_voids_the_result(self):
        script = ("import json, os, sys; d = sys.argv[1]; "
                  "open(os.path.join(d, 'split_config.json'), 'a').write(' '); "
                  "json.dump({'val_acc': 0.99}, open(os.path.join(d, 'local_eval.json'), 'w'))")
        cmd = lambda run_dir: [c.sys.executable, "-c", script, run_dir]
        h = c.run_loop(OFFICIAL, BASELINE_ACC, "baseline", c.ScriptedLLM([("x", marker("acc=0.9"))]),
                       cmd, self.runs, self.state, 1, 20, log=lambda s: None)
        self.assertEqual((h[1]["status"], h[1]["val_acc"], h[1]["best_id"]),
                         ("invalid_patch", None, "baseline"))
        self.assertIn("split_config.json", h[1]["error"])
        self.assertEqual(c.read_text(os.path.join(self.state, "best", "algorithm.py")), c.read_text(OFFICIAL))


class TestStatic(unittest.TestCase):

    def test_real_runner_command_targets_local_eval(self):
        cmd = c.real_runner_cmd("some_dir")
        self.assertEqual(cmd[1:], [c.LOCAL_EVAL, "--workdir", "some_dir"])

    def test_prompt_shows_best_code_score_and_history(self):
        hist = [{"id": "007_loop", "status": "crash", "val_acc": None, "hypothesis": "bigger lr",
                 "error": "line1\nRuntimeError: nan loss"}]
        prompt = c.build_prompt("x = 1\n", 0.1701, hist)
        for text in ("x = 1", "0.1701", "007_loop [crash]", "bigger lr", "RuntimeError: nan loss",
                     "must be picklable", "NOT passed to the optimizer"):
            self.assertIn(text, prompt)


if __name__ == "__main__":
    unittest.main()
