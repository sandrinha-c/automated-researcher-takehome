"""Automated-research controller (single file, no framework, standard library only).

One round of the loop:

    1. propose()         LLM decision   read best code + history -> a new algorithm.py
    2. apply_edit()      fixed rule     write the candidate into its own run directory
    3. validate()        fixed rule     static checks before any GPU time is spent
    4. run_experiment()  fixed rule     subprocess -> local_eval.py, with a timeout
    5. evaluate()        fixed rule     accept only if val_acc is STRICTLY greater than best
    6. record()          fixed rule     append one line to runs.jsonl (+ diff in the run dir)

The LLM only ever produces the text of algorithm.py. It cannot choose what is run,
how it is scored, or whether it is accepted.

Files written:
    <runs-dir>/NNN_loop/       one directory per candidate: algorithm.py, diff.patch,
                               prompt.txt (the full context sent to the LLM), llm_reply.txt,
                               stdout.log, local_eval.json
    <state-dir>/baseline/algorithm.py   byte copy of the baseline, never overwritten
    <state-dir>/best/algorithm.py       current best
    <state-dir>/runs.jsonl              append-only log, one JSON object per line

The LLM is reached through the Claude Code command line (`claude -p`, already logged in,
no API key) with every tool switched off, so it can only answer with text.

Real run (one GPU job at a time, about 26 minutes per experiment):
    python controller.py --max-experiments 2
Try it without a GPU or the LLM (scripted "LLM" + fake evaluator, in a temp folder):
    python controller.py --fake --max-experiments 7
"""
import argparse
import ast
import datetime
import difflib
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
TASK_DIR = os.path.join(ROOT, "task")
LOCAL_EVAL = os.path.join(ROOT, "local_eval.py")
PROTECTED_FILES = ("train_eval_baseline.py", "split_config.json")  # copied from task/, never edited
REQUIRED_SYMBOLS = ("get_model", "get_training_config", "get_augmentation", "BarlowTwinsLoss")

CODE_BLOCK = re.compile(r"```(?:python|py)?[ \t]*\r?\n(.*?)```", re.DOTALL)
HYPOTHESIS = re.compile(r"^HYPOTHESIS:[ \t]*(.+)$", re.MULTILINE)
FAKE_MARKER = re.compile(r"^# FAKE_RUN: *(\S+)[ \t]*$", re.MULTILINE)


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


# --------------------------------------------------------------------------- 1. propose

def build_prompt(best_code, best_acc, history):
    """Everything the LLM gets to see: the rules, past results, and the current best code."""
    lines = []
    for r in [r for r in history if r["status"] != "llm_error"][-20:]:
        acc = "-" if r["val_acc"] is None else f"{r['val_acc']:.4f}"
        lines.append(f"- {r['id']} [{r['status']}] val_acc={acc} | {r['hypothesis']}")
        if r["error"]:
            lines.append("    error: " + r["error"].replace("\n", "\n    "))
    return f"""You are improving a self-supervised learning method (Barlow Twins, ResNet-18, CIFAR-100).
The score is validation accuracy of a linear probe on the frozen backbone. Higher is better.
A candidate replaces the current best only if its accuracy is strictly greater.
Every score comes from one training run of 20 pretrain epochs with one fixed seed (42), in
deterministic mode: the same code always gives the same score, but the baseline varies by
several points between seeds, so a small gain may not be a real improvement.

Rules:
- Return the COMPLETE new algorithm.py in one ```python block. Nothing else is editable.
- Keep these top-level names: {", ".join(REQUIRED_SYMBOLS)}.
- The model must set self.backbone, self.projector and self.backbone_dim.
- Imports are limited to: {", ".join(sorted(ALLOWED_IMPORTS))}.
- No file access, no dataset loading, no downloads (so no pretrained weights), and do not
  set seeds or deterministic flags. Do not mention the evaluator or split file names.
- pretrain_epochs, linear_eval_epochs, batch_size, linear_batch_size and linear_lr are
  overridden by the evaluator, so changing them has no effect.
- One focused change per proposal.

Reply format:
HYPOTHESIS: <one sentence: what you change and why it should help>
```python
<full algorithm.py>
```

Experiments so far (current best val_acc = {best_acc:.4f}):
{chr(10).join(lines) or "(none)"}

Current best algorithm.py:
```python
{best_code}```
"""


def parse_reply(reply):
    """-> (hypothesis, code, error). `code` is None when the reply has no usable code block."""
    m = HYPOTHESIS.search(reply)
    hypothesis = m.group(1).strip() if m else ""
    blocks = CODE_BLOCK.findall(reply)
    if not blocks:
        return hypothesis, None, "reply contains no ```python code block"
    code = max(blocks, key=len).replace("\r\n", "\n")
    return hypothesis, code if code.endswith("\n") else code + "\n", None


class LLMError(Exception):
    """The LLM call itself failed (not logged in, rate limit, time limit, bad output)."""


def propose(best_code, best_acc, history, llm):
    """LLM DECISION. `llm` is any callable prompt -> reply text that raises LLMError on
    failure and describes its last call in `llm.meta` (ClaudeCLI below, or a scripted fake)."""
    prompt = build_prompt(best_code, best_acc, history)
    out = {"prompt": prompt, "reply": "", "hypothesis": "", "code": None, "error": None,
           "status": "invalid_patch"}
    try:
        out["reply"] = llm(prompt)
    except LLMError as e:
        out.update(status="llm_error", error=str(e))
    else:
        out["hypothesis"], out["code"], out["error"] = parse_reply(out["reply"])
    out["llm"] = dict(getattr(llm, "meta", {}))
    return out


SYSTEM_PROMPT = ("You are a machine learning researcher. Answer with text only, "
                 "exactly in the reply format the user asks for.")


class ClaudeCLI:
    """Calls the Claude Code command line in print mode: prompt on stdin, JSON on stdout.
    All built-in tools, MCP servers and skills are off and the session is not saved; it
    runs in an empty folder so it cannot see this repository."""

    def __init__(self, model, effort, timeout_s=600):
        exe = shutil.which("claude")  # on Windows this resolves to claude.cmd
        if not exe:
            raise SystemExit("`claude` command not found (npm install -g @anthropic-ai/claude-code)")
        self.cmd = [exe, "-p", "--model", model, "--effort", effort, "--output-format", "json",
                    "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands",
                    "--system-prompt", SYSTEM_PROMPT, "--tools", ""]
        self.timeout_s = timeout_s
        self.cwd = tempfile.mkdtemp(prefix="controller_llm_")
        self.request = {"model": model, "effort": effort, "system_prompt": SYSTEM_PROMPT}
        self.meta = dict(self.request)

    def __call__(self, prompt):
        t0 = time.time()
        self.meta = dict(self.request)
        proc = subprocess.Popen(self.cmd, cwd=self.cwd, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                start_new_session=(os.name != "nt"))
        try:
            stdout, stderr = proc.communicate(prompt.encode("utf-8"), timeout=self.timeout_s)
        except subprocess.TimeoutExpired:
            kill_tree(proc)
            raise LLMError(f"claude gave no answer within {self.timeout_s:g}s")
        finally:
            self.meta["seconds"] = round(time.time() - t0, 1)
        text = stdout.decode("utf-8", errors="replace")
        try:
            data = json.loads(text)
            reply = data["result"]
            if data.get("is_error") or not isinstance(reply, str):
                raise ValueError("claude reported an error")
        except (ValueError, KeyError, TypeError):
            detail = (text.strip() or stderr.decode("utf-8", errors="replace").strip())[-500:]
            raise LLMError(f"claude call failed (exit code {proc.returncode}): {detail}")
        # model_usage is what the command line reports it actually used (it can list a
        # second, small model for its own housekeeping next to the requested one).
        self.meta.update(model_usage=data.get("modelUsage"), cost_usd=data.get("total_cost_usd"))
        return reply


# ------------------------------------------------------------------------ 2. apply_edit

def apply_edit(code, parent_code, parent_id, run_dir, data_dir):
    """Write the candidate and a ready-to-run working directory. Returns the diff text."""
    write_text(os.path.join(run_dir, "algorithm.py"), code)
    for name in PROTECTED_FILES:  # always fresh copies of the official files
        shutil.copyfile(os.path.join(TASK_DIR, name), os.path.join(run_dir, name))
    if data_dir:  # share one CIFAR-100 download between runs
        link = os.path.join(run_dir, "data")
        if os.name == "nt":
            subprocess.run(["cmd", "/c", "mklink", "/J", link, data_dir], check=True,
                           stdout=subprocess.DEVNULL)
        else:
            os.symlink(data_dir, link)
    diff = "".join(difflib.unified_diff(
        parent_code.splitlines(keepends=True), code.splitlines(keepends=True),
        fromfile=f"{parent_id}/algorithm.py", tofile=f"{os.path.basename(run_dir)}/algorithm.py"))
    write_text(os.path.join(run_dir, "diff.patch"), diff)
    return diff


# -------------------------------------------------------------------------- 3. validate

# algorithm.py only needs to build a model, a loss and an augmentation. Everything below is
# refused before any GPU time is spent, so a candidate cannot reach the evaluator, the split
# file, the dataset labels, other files, or the seeds.
ALLOWED_IMPORTS = {"torch", "torchvision", "numpy", "math", "random", "typing", "functools",
                   "itertools", "collections", "copy", "dataclasses", "warnings"}
REQUIRED_MODEL_ATTRS = ("backbone", "projector", "backbone_dim")  # read by the evaluator
FORBIDDEN_CALLS = {"open", "exec", "eval", "compile", "__import__", "globals", "locals"}
FORBIDDEN_ATTRS = {
    "datasets": "loads a dataset (data and labels belong to the evaluator)",
    "save": "writes a file", "load": "reads a file", "hub": "downloads code or weights",
    "load_state_dict_from_url": "downloads weights",
    "seed": "changes the fixed seed", "manual_seed": "changes the fixed seed",
    "manual_seed_all": "changes the fixed seed",
    "use_deterministic_algorithms": "changes deterministic mode",
    "cudnn": "changes deterministic mode",
}
FORBIDDEN_TEXT = ("split_config", "train_eval_baseline", "local_eval", "results_tmp",
                  "val_info", "model_checkpoint")
ALLOWED_DUNDERS = {"__init__", "__class__", "__name__"}


def validate(code):
    """Static checks on the candidate source; nothing is imported or executed.
    Returns None if OK, otherwise the reasons (recorded and fed back to the LLM).

    This is a filter for honest mistakes and obvious shortcuts, not a sandbox. Two further
    guards do not depend on it: local_eval.py refuses to start if the evaluator or the split
    file differ from the official copies, and run_loop() re-checks them after every run.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"SyntaxError: {e.msg} (line {e.lineno})"
    problems = []

    defined = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            defined.add(node.name)
        elif isinstance(node, ast.Assign):
            defined.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            defined.update((a.asname or a.name).split(".")[0] for a in node.names)
    missing = [s for s in REQUIRED_SYMBOLS if s not in defined]
    if missing:
        problems.append("missing required top-level names: " + ", ".join(missing))

    assigned_attrs = {n.attr for n in ast.walk(tree)
                      if isinstance(n, ast.Attribute) and isinstance(n.ctx, ast.Store)}
    missing = [a for a in REQUIRED_MODEL_ATTRS if a not in assigned_attrs]
    if missing:
        problems.append("the model never sets self." + ", self.".join(missing) +
                        " (the evaluator reads .backbone, .projector and .backbone_dim)")

    for node in ast.walk(tree):
        line = f"line {getattr(node, 'lineno', '?')}: "
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            if isinstance(node, ast.ImportFrom) and node.level:
                modules = ["(relative import)"]
            elif isinstance(node, ast.ImportFrom):
                modules = [node.module]
            else:
                modules = [a.name for a in node.names]
            for m in modules:
                if m.split(".")[0] not in ALLOWED_IMPORTS:
                    problems.append(f"{line}import of '{m}' is not allowed "
                                    f"(allowed: {', '.join(sorted(ALLOWED_IMPORTS))})")
            names = [a.name for a in node.names] if isinstance(node, ast.ImportFrom) else []
            names += [part for m in modules for part in m.split(".")[1:]]
            for n in names:
                if n in FORBIDDEN_ATTRS:
                    problems.append(f"{line}'{n}' is not allowed: {FORBIDDEN_ATTRS[n]}")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_CALLS | {"__builtins__"}:
            problems.append(f"{line}'{node.id}' is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr in FORBIDDEN_ATTRS:
                problems.append(f"{line}'.{node.attr}' is not allowed: {FORBIDDEN_ATTRS[node.attr]}")
            elif node.attr.startswith("__") and node.attr not in ALLOWED_DUNDERS:
                problems.append(f"{line}'.{node.attr}' is not allowed")
        elif isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes)):
            text = node.value if isinstance(node.value, str) else node.value.decode("latin-1")
            for word in FORBIDDEN_TEXT:
                if word in text:
                    problems.append(f"{line}mentions '{word}' (evaluator files are off limits)")
    return "\n".join(problems[:8]) or None


def protected_files_changed(run_dir):
    """Names of the evaluator / split copies in run_dir that no longer match task/."""
    def digest(path):
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    return [n for n in PROTECTED_FILES
            if not os.path.exists(os.path.join(run_dir, n))
            or digest(os.path.join(run_dir, n)) != digest(os.path.join(TASK_DIR, n))]


# -------------------------------------------------------------------- 4. run_experiment

def kill_tree(proc):
    """Kill the process and its children (the evaluator starts DataLoader workers)."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        import signal
        os.killpg(proc.pid, signal.SIGKILL)
    proc.wait()


def log_tail(path, n=15):
    with open(path, encoding="utf-8", errors="replace") as f:
        return "\n".join(f.read().splitlines()[-n:])


def run_experiment(run_dir, cmd, timeout_s):
    """Run the evaluator as a separate process. -> {status: ok|crash|timeout, val_acc, seconds, error}"""
    log_path = os.path.join(run_dir, "stdout.log")
    t0 = time.time()
    with open(log_path, "wb") as log:
        proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=ROOT,
                                start_new_session=(os.name != "nt"))
        try:
            code = proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            kill_tree(proc)
            code = None
    out = {"status": "crash", "val_acc": None, "seconds": round(time.time() - t0, 1), "error": None}
    if code is None:
        out.update(status="timeout", error=f"killed after the {timeout_s:g}s time limit")
    elif code != 0:
        out["error"] = f"exit code {code}\n{log_tail(log_path)}"
    else:
        try:
            acc = json.loads(read_text(os.path.join(run_dir, "local_eval.json")))["val_acc"]
            if not (isinstance(acc, float) and math.isfinite(acc) and 0.0 <= acc <= 1.0):
                raise ValueError(f"val_acc is not a valid accuracy: {acc!r}")
            out.update(status="ok", val_acc=acc)
        except (OSError, ValueError, KeyError) as e:
            out["error"] = f"no usable result: {e}"
    return out


# -------------------------------------------------------------------------- 5. evaluate

def evaluate(val_acc, best_acc):
    """Acceptance rule: strictly greater. A tie keeps the old best."""
    return val_acc > best_acc


# ---------------------------------------------------------------------------- 6. record

def record(log_path, entry):
    with open(log_path, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def load_history(log_path):
    with open(log_path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


# ------------------------------------------------------------------------------- loop

def next_run_number(runs_dir):
    nums = [int(n[:3]) for n in os.listdir(runs_dir) if re.match(r"\d{3}_", n)]
    return max(nums, default=-1) + 1


def run_loop(baseline_path, baseline_acc, baseline_id, llm, runner_cmd, runs_dir, state_dir,
             max_experiments, timeout_s, data_dir=None, log=print):
    """Run until `max_experiments` candidates are in the log (every proposal counts,
    including invalid ones and failed LLM calls). Restarting with the same state_dir resumes. Returns the history."""
    os.makedirs(runs_dir, exist_ok=True)
    log_path = os.path.join(state_dir, "runs.jsonl")
    baseline_copy = os.path.join(state_dir, "baseline", "algorithm.py")
    best_path = os.path.join(state_dir, "best", "algorithm.py")

    if not os.path.exists(log_path):  # first start: the baseline is the initial best
        os.makedirs(os.path.dirname(baseline_copy))
        os.makedirs(os.path.dirname(best_path))
        shutil.copyfile(baseline_path, baseline_copy)
        shutil.copyfile(baseline_path, best_path)
        record(log_path, {
            "id": baseline_id, "time": datetime.datetime.now().isoformat(timespec="seconds"),
            "status": "baseline", "hypothesis": "unmodified baseline", "parent": None,
            "val_acc": baseline_acc, "best_before": None, "best_after": baseline_acc,
            "best_id": baseline_id, "seconds": None, "error": None})

    history = load_history(log_path)
    best_id, best_acc = history[-1]["best_id"], history[-1]["best_after"]
    # The log is the source of truth: rebuild best/ from the run that the log says is best.
    best_src = baseline_copy if best_id == history[0]["id"] else os.path.join(runs_dir, best_id, "algorithm.py")
    best_code = read_text(best_src)
    write_text(best_path, best_code)

    while len(history) - 1 < max_experiments:
        run_id = f"{next_run_number(runs_dir):03d}_loop"
        run_dir = os.path.join(runs_dir, run_id)
        os.makedirs(run_dir)
        log(f"[{run_id}] proposing (best = {best_id}, {best_acc:.4f})")

        p = propose(best_code, best_acc, history, llm)                                   # 1
        write_text(os.path.join(run_dir, "prompt.txt"), p["prompt"])
        write_text(os.path.join(run_dir, "llm_reply.txt"), p["reply"])
        entry = {"id": run_id, "time": datetime.datetime.now().isoformat(timespec="seconds"),
                 "status": p["status"], "hypothesis": p["hypothesis"], "parent": best_id,
                 "val_acc": None, "best_before": best_acc, "seconds": None, "error": p["error"],
                 "llm": p["llm"]}

        if p["code"] is not None:
            apply_edit(p["code"], best_code, best_id, run_dir, data_dir)                 # 2
            entry["error"] = validate(p["code"])                                         # 3
        if entry["error"] is None:
            result = run_experiment(run_dir, runner_cmd(run_dir), timeout_s)             # 4
            entry.update(result)
            changed = protected_files_changed(run_dir)
            if changed:  # the score cannot be trusted, whatever it is
                entry.update(status="invalid_patch", val_acc=None,
                             error="evaluator files changed during the run: " + ", ".join(changed))
            elif result["status"] == "ok":
                accepted = evaluate(result["val_acc"], best_acc)                         # 5
                entry["status"] = "accepted" if accepted else "rejected"
                if accepted:
                    best_id, best_acc, best_code = run_id, result["val_acc"], p["code"]
                    write_text(best_path, best_code)

        entry.update(best_after=best_acc, best_id=best_id)
        record(log_path, entry)                                                          # 6
        history.append(entry)
        acc = "" if entry["val_acc"] is None else f" val_acc={entry['val_acc']:.4f}"
        log(f"[{run_id}] {entry['status']}{acc}" +
            (f" | {entry['error'].splitlines()[-1]}" if entry["error"] else ""))
    return history


# ------------------------------------------------- fake LLM + fake evaluator (no GPU/key)

def fake_eval(workdir):
    """Stands in for local_eval.py. Obeys a '# FAKE_RUN: ...' line in algorithm.py:
    acc=0.185 -> report that accuracy, crash -> raise, sleep=30 -> hang for 30 s."""
    m = FAKE_MARKER.search(read_text(os.path.join(workdir, "algorithm.py")))
    action = m.group(1) if m else "acc=0.17"
    if action == "crash":
        raise RuntimeError("fake crash: CUDA out of memory")
    if action.startswith("sleep="):
        time.sleep(float(action[6:]))
        action = "acc=0.17"
    with open(os.path.join(workdir, "local_eval.json"), "w") as f:
        json.dump({"val_acc": float(action[4:]), "fake": True}, f)


def fake_runner_cmd(run_dir):
    return [sys.executable, os.path.abspath(__file__), "--fake-eval", run_dir]


def real_runner_cmd(run_dir):
    return [sys.executable, LOCAL_EVAL, "--workdir", run_dir]


def with_marker(code, action):
    return f"# FAKE_RUN: {action}\n" + FAKE_MARKER.sub("", code).lstrip("\n")


# (hypothesis, function best_code -> candidate code). Baseline accuracy in fake mode is 0.1701.
FAKE_SCRIPT = [
    ("fake: better result", lambda c: with_marker(c, "acc=0.1850")),             # accepted
    ("fake: syntax error", lambda c: c + "\ndef broken(:\n"),                    # invalid_patch
    ("fake: crashes", lambda c: with_marker(c, "crash")),                        # crash
    ("fake: hangs", lambda c: with_marker(c, "sleep=60")),                       # timeout
    ("fake: worse result", lambda c: with_marker(c, "acc=0.1600")),              # rejected
    ("fake: ties the best", lambda c: with_marker(c, "acc=0.1850")),             # rejected (tie)
    ("fake: better again", lambda c: with_marker(c, "acc=0.1900")),              # accepted
]


class ScriptedLLM:
    """Plays a fixed script, but through the same prompt -> reply text path as a real LLM:
    it reads the best code out of the prompt and answers in the required reply format."""

    meta = {"model": "scripted-fake"}

    def __init__(self, script):
        self.script, self.prompts = script, []

    def __call__(self, prompt):
        hypothesis, edit = self.script[len(self.prompts) % len(self.script)]
        self.prompts.append(prompt)
        best_code = CODE_BLOCK.findall(prompt)[-1]
        return f"HYPOTHESIS: {hypothesis}\n```python\n{edit(best_code)}```\n"


# ------------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--max-experiments", type=int, default=3,
                    help="total number of candidates in the log (invalid proposals count)")
    ap.add_argument("--timeout-min", type=float, default=40,
                    help="time limit per experiment (the baseline takes about 26 min)")
    ap.add_argument("--model", default="claude-opus-5-5", help="model passed to `claude --model`")
    ap.add_argument("--effort", default="medium", help="reasoning effort passed to `claude --effort`")
    ap.add_argument("--baseline-dir", default=os.path.join(ROOT, "runs", "003_det_s42"),
                    help="finished baseline run: algorithm.py + local_eval.json")
    ap.add_argument("--runs-dir", default=os.path.join(ROOT, "runs"))
    ap.add_argument("--state-dir", default=os.path.join(ROOT, "loop"))
    ap.add_argument("--fake", action="store_true",
                    help="scripted LLM + fake evaluator in a temp folder (no GPU, no LLM call)")
    ap.add_argument("--fake-eval", metavar="WORKDIR", help=argparse.SUPPRESS)
    args = ap.parse_args()
    sys.stdout.reconfigure(errors="replace")

    if args.fake_eval:
        return fake_eval(args.fake_eval)

    if args.fake:
        tmp = tempfile.mkdtemp(prefix="controller_fake_")
        history = run_loop(
            baseline_path=os.path.join(TASK_DIR, "algorithm.py"), baseline_acc=0.1701,
            baseline_id="baseline", llm=ScriptedLLM(FAKE_SCRIPT), runner_cmd=fake_runner_cmd,
            runs_dir=os.path.join(tmp, "runs"), state_dir=os.path.join(tmp, "loop"),
            max_experiments=args.max_experiments, timeout_s=3)
        print(f"output: {tmp}")
    else:
        baseline_dir = os.path.abspath(args.baseline_dir)
        baseline_acc = json.loads(read_text(os.path.join(baseline_dir, "local_eval.json")))["val_acc"]
        history = run_loop(
            baseline_path=os.path.join(baseline_dir, "algorithm.py"), baseline_acc=baseline_acc,
            baseline_id=os.path.basename(baseline_dir), llm=ClaudeCLI(args.model, args.effort), runner_cmd=real_runner_cmd,
            runs_dir=os.path.abspath(args.runs_dir), state_dir=os.path.abspath(args.state_dir),
            max_experiments=args.max_experiments, timeout_s=args.timeout_min * 60,
            data_dir=os.path.join(ROOT, "data"))

    print("\nid            status         val_acc  best")
    for r in history:
        acc = "   -   " if r["val_acc"] is None else f"{r['val_acc']:.4f} "
        print(f"{r['id']:<13} {r['status']:<14} {acc}  {r['best_after']:.4f}")


if __name__ == "__main__":
    main()
