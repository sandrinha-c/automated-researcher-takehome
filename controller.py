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
Multi-seed search (run_search below: screen on one seed, confirm on all, explore when stuck):
    python controller.py --seeds 42,43,44 --max-runs 23
Try it without a GPU or the LLM (scripted "LLM" + fake evaluator, in a temp folder):
    python controller.py --fake --max-experiments 8
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
import statistics
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
CATEGORY = re.compile(r"^CATEGORY:[ \t]*([A-Za-z]+)", re.MULTILINE)
BASIS = re.compile(r"^BASIS:[ \t]*(.+)$", re.MULTILINE)
CATEGORIES = ("augmentation", "loss", "architecture", "optimisation", "other")
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
        loss = f" pretrain_loss={r['pretrain_loss']}" if r.get("pretrain_loss") else ""
        lines.append(f"- {r['id']} [{r['status']}] val_acc={acc}{loss} | {r['hypothesis']}")
        if r["error"]:
            lines.append("    error: " + r["error"].replace("\n", "\n    "))
    return f"""You are improving a self-supervised learning method (Barlow Twins, ResNet-18, CIFAR-100).
The score is validation accuracy of a linear probe on the frozen backbone. Higher is better.
A candidate replaces the current best only if its accuracy is strictly greater.
Every score comes from one training run of 20 pretrain epochs with one fixed seed (42), in
deterministic mode: the same code always gives the same score, but the baseline varies by
several points between seeds, so a small gain may not be a real improvement.

{rules_text()}
- pretrain_loss in the list below is the mean loss of the first -> last pretrain epoch
  ("nan" means training diverged). It is not comparable between different loss functions.

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


def rules_text():
    """The part of the prompt that is the same in both modes: what may be edited and how
    the fixed evaluator calls it."""
    return f"""Rules:
- Return the COMPLETE new algorithm.py in one ```python block. Nothing else is editable.
- Keep these top-level names: {", ".join(REQUIRED_SYMBOLS)}.
- The model must set self.backbone, self.projector and self.backbone_dim.
- Imports are limited to: {", ".join(sorted(ALLOWED_IMPORTS))}.
- No file access, no dataset loading, no downloads (so no pretrained weights), and do not
  set seeds or deterministic flags. Do not mention the evaluator or split file names.
- pretrain_epochs, linear_eval_epochs, batch_size, linear_batch_size and linear_lr are
  overridden by the evaluator, so changing them has no effect.
- One focused change per proposal, and not the same code as an earlier experiment.

How the evaluator uses your file (it is fixed and you cannot change it):
- config = get_training_config() must contain lr, weight_decay and lambda_param.
- The loss is built as BarlowTwinsLoss(lambda_param=config["lambda_param"], embedding_dim=2048)
  and called as loss(z1, z2). Its own parameters are NOT passed to the optimizer.
- model(x) must return (features, projections); features must have backbone_dim columns.
- Pretraining is SGD(model.parameters(), lr, momentum=0.9, weight_decay) with a cosine
  schedule over the epochs and no warmup. One optimizer step per batch of two views.
- get_augmentation() is called once and applied to a PIL image, twice per image, inside
  DataLoader worker processes: it must be picklable (no lambda, no local function)."""


def pct(x):
    return f"{100 * x:.2f}"


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def build_search_prompt(best_code, history, seeds, margin, stuck, explore_after, timeout_s,
                        assigned=None, explore_every=0):
    """Prompt of the multi-seed search: per-seed scores, the size of the noise, what each
    earlier candidate changed, its loss curve and feature statistics, and which categories
    have been tried. When the search is stuck it asks for a different category."""
    best = next(r for r in history if r["id"] == history[-1]["best_id"])
    keys = [str(x) for x in seeds]
    values = [best["scores"][k] for k in keys]
    noise = 2 * statistics.stdev(values) * math.sqrt(2 / len(values)) if len(values) > 1 else 0.0

    lines = []
    for r in [r for r in history if r["status"] != "llm_error"][-20:]:
        scores = ", ".join(f"seed {k}={pct(v)}" for k, v in (r.get("scores") or {}).items()) or "not run"
        mean = f", mean={pct(r['val_acc'])}" if r["val_acc"] is not None else ""
        mins = f" | {r['seconds'] / 60 / len(r['scores']):.1f} min per run" if r.get("seconds") and r.get("scores") else ""
        tags = f" category={r['category']} basis={r['basis']}" if r.get("category") else ""
        lines.append(f"- {r['id']} [{r['status']}]{tags} | {scores}{mean}{mins}")
        lines.append(f"    hypothesis: {r['hypothesis']}")
        for sign, text in (r.get("changes") or []):
            lines.append(f"    {sign} {text}")
        if r.get("loss_curve"):
            lines.append("    pretrain loss per epoch (first seed): " + " ".join(f"{v:.4g}" for v in r["loss_curve"]))
        elif r.get("pretrain_loss"):
            lines.append(f"    pretrain loss, first -> last epoch: {r['pretrain_loss']}")
        f = r.get("features")
        if f and f.get("finite"):
            lines.append(f"    features (first seed): effective rank {f['effective_rank']} of {f['dim']}, "
                         f"mean std {f['mean_std']}")
        elif f and f.get("finite") is False:
            lines.append("    features (first seed): NOT FINITE (training diverged)")
        if r["error"]:
            lines.append("    error: " + r["error"].replace("\n", "\n    "))

    tried = [r for r in history if r.get("category") and r.get("scores")]
    tally = ", ".join(f"{c}: {sum(r['category'] == c for r in tried)} tried / "
                      f"{sum(r['category'] == c and r['status'] == 'accepted' for r in tried)} accepted"
                      for c in CATEGORIES)
    explore = ""
    if assigned:
        explore = (f"\nASSIGNED CATEGORY: this proposal must be in category '{assigned}' (it is refused "
                   f"otherwise, without a training run). The controller assigns the category that has been "
                   f"trained least to every {ordinal(explore_every)} candidate that is trained; the other "
                   f"candidates are your free choice.\n")
    elif stuck >= explore_after:
        blocked = blocked_category(history)
        explore = (f"\nEXPLORE: the last {stuck} candidates that were run were not accepted. This proposal "
                   f"must NOT be in category '{blocked}' (it is refused otherwise). Pick a direction "
                   f"that has been tried least.\n")

    return f"""You are improving a self-supervised learning method (Barlow Twins, ResNet-18, CIFAR-100).
The score is validation accuracy (in %) of a linear probe on the frozen backbone. Higher is better.
Every training run has 20 pretrain epochs and is deterministic for a given code and seed.

How a candidate is judged (fixed rules in the controller, not your decision):
- It is first trained once with seed {keys[0]}. If that score is more than {100 * margin:g} point(s) below the
  current best's score on that seed, it is dropped without further runs (screened_out).
- Otherwise it is also trained with seeds {", ".join(keys[1:])}. It replaces the current best only if its
  mean over the {len(keys)} seeds is strictly greater than the current best's mean.
- Noise: the current best ({best["id"]}) scores {", ".join(pct(v) for v in values)} on the {len(keys)} seeds. A difference
  in mean below about {100 * noise:.1f} points is within noise, so prefer a change that should help
  clearly on every seed over a small tweak.
- A run is killed after {timeout_s / 60:g} minutes.

{rules_text()}

What the list of experiments shows for each candidate: its scores per seed, the code lines
it changed against its parent (comments and docstrings left out), the mean pretrain loss of
every epoch (not comparable between different loss functions; "nan" = diverged) and two
numbers about the frozen features of the validation images: effective rank (1 = collapsed
to one direction, {512} = all dimensions used for a 512-d backbone) and mean standard deviation.
Use them to reason about WHY a candidate did what it did.

Reply format:
HYPOTHESIS: <one sentence: what you change and why it should help>
CATEGORY: <one of: {", ".join(CATEGORIES)}>
BASIS: <known | results | both> - <known = a recipe you recall from papers or other code;
results = you reasoned from the experiments below; say which experiment ids you used>
```python
<full algorithm.py>
```

Experiments so far (current best = {best["id"]}, mean {pct(best["val_acc"])}):
{chr(10).join(lines) or "(none)"}

Categories so far: {tally}
{explore}
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


def propose(prompt, llm):
    """LLM DECISION. `llm` is any callable prompt -> reply text that raises LLMError on
    failure and describes its last call in `llm.meta` (ClaudeCLI below, or a scripted fake)."""
    out = {"prompt": prompt, "reply": "", "hypothesis": "", "code": None, "error": None,
           "status": "invalid_patch", "category": None, "basis": None}
    try:
        out["reply"] = llm(prompt)
    except LLMError as e:
        out.update(status="llm_error", error=str(e))
    else:
        out["hypothesis"], out["code"], out["error"] = parse_reply(out["reply"])
        m = CATEGORY.search(out["reply"].split("```")[0])
        out["category"] = m.group(1).lower() if m and m.group(1).lower() in CATEGORIES else "other"
        m = BASIS.search(out["reply"].split("```")[0])
        out["basis"] = m.group(1).strip()[:200] if m else None
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

def prepare_workdir(code, workdir, data_dir):
    """A folder the evaluator can run in: the candidate, fresh copies of the official
    files, and a link to the shared dataset."""
    os.makedirs(workdir, exist_ok=True)
    write_text(os.path.join(workdir, "algorithm.py"), code)
    for name in PROTECTED_FILES:  # always fresh copies of the official files
        shutil.copyfile(os.path.join(TASK_DIR, name), os.path.join(workdir, name))
    if data_dir:  # share one CIFAR-100 download between runs
        link = os.path.join(workdir, "data")
        if os.name == "nt":
            subprocess.run(["cmd", "/c", "mklink", "/J", link, data_dir], check=True,
                           stdout=subprocess.DEVNULL)
        else:
            os.symlink(data_dir, link)


def code_lines(source):
    """The lines of real code: no blank lines, comments or docstrings."""
    skip = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            first = node.body[0] if node.body else None
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
                    and isinstance(first.value.value, str):
                skip.update(range(first.lineno, first.end_lineno + 1))
    lines = []
    for number, line in enumerate(source.splitlines(), 1):
        line = line.split("  #")[0].strip()
        if line and not line.startswith("#") and number not in skip:
            lines.append(line)
    return lines


def code_changes(parent_code, code, limit=16):
    """[(sign, line)] of the code lines that differ, for the next prompt."""
    try:
        diff = difflib.unified_diff(code_lines(parent_code), code_lines(code), n=0, lineterm="")
    except SyntaxError:
        return []
    out = [(d[0], d[1:][:160]) for d in diff if d[:1] in "+-" and not d.startswith(("+++", "---"))]
    return out[:limit] + ([("…", f"{len(out) - limit} more changed lines")] if len(out) > limit else [])


def apply_edit(code, parent_code, parent_id, run_dir, data_dir, workdir=True):
    """Write the candidate into its run folder (by default also a ready-to-run working
    directory there). Returns the diff text."""
    if workdir:
        prepare_workdir(code, run_dir, data_dir)
    else:
        write_text(os.path.join(run_dir, "algorithm.py"), code)
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
FORBIDDEN_CALLS = {"open", "exec", "eval", "compile", "__import__", "globals", "locals",
                   "getattr", "setattr", "delattr"}  # getattr(torch, "lo" + "ad") hides a name
FORBIDDEN_ATTRS = {
    "datasets": "loads a dataset (data and labels belong to the evaluator)",
    "save": "writes a file", "load": "reads a file", "hub": "downloads code or weights",
    "load_state_dict_from_url": "downloads weights",
    "seed": "changes the fixed seed", "manual_seed": "changes the fixed seed",
    "manual_seed_all": "changes the fixed seed",
    "use_deterministic_algorithms": "changes deterministic mode",
    "cudnn": "changes deterministic mode",
    "os": "reaches the operating system", "sys": "reaches the interpreter",
    "subprocess": "starts a process",
    "fromfile": "reads a file", "memmap": "reads a file", "tofile": "writes a file",
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

    # Names bound by imports. Assigning to an attribute of one of them (for example
    # `torch.optim.SGD = ...`) would change the evaluator's own training or scoring code.
    imported = {(a.asname or a.name).split(".")[0] for n in ast.walk(tree)
                if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}

    for node in ast.walk(tree):
        line = f"line {getattr(node, 'lineno', '?')}: "
        if isinstance(node, ast.Attribute) and not isinstance(node.ctx, ast.Load):
            base = node.value
            while isinstance(base, (ast.Attribute, ast.Subscript, ast.Call)):
                base = base.func if isinstance(base, ast.Call) else base.value
            if isinstance(base, ast.Name) and base.id in imported:
                problems.append(f"{line}assigning to '{base.id}...{node.attr}' is not allowed: "
                                "it changes an imported library for the evaluator too")
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


def read_text_lenient(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read().replace("\r\n", "\n")


def log_tail(path, n=15):
    return "\n".join(read_text_lenient(path).splitlines()[-n:])


PRETRAIN_LOSS = re.compile(r"^Pretrain Epoch [0-9]+/[0-9]+: Loss=(\S+)", re.MULTILINE)


def pretrain_loss(log_path):
    """'first -> last' pretrain loss printed by the evaluator, or None. A diverged run
    still ends with a (chance-level) accuracy, so the loss is the only sign of it."""
    found = PRETRAIN_LOSS.findall(read_text_lenient(log_path))
    return f"{found[0]} -> {found[-1]}" if found else None


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
        except BaseException:  # Ctrl+C or any other stop: do not leave a job on the GPU
            kill_tree(proc)
            raise
    out = {"status": "crash", "val_acc": None, "seconds": round(time.time() - t0, 1), "error": None,
           "pretrain_loss": pretrain_loss(log_path)}
    if code is None:
        out.update(status="timeout", error=f"killed after the {timeout_s:g}s time limit")
    elif code != 0:
        out["error"] = f"exit code {code}\n{log_tail(log_path)}"
    else:
        try:
            info = json.loads(read_text(os.path.join(run_dir, "local_eval.json")))
            acc = info["val_acc"]
            if not (isinstance(acc, float) and math.isfinite(acc) and 0.0 <= acc <= 1.0):
                raise ValueError(f"val_acc is not a valid accuracy: {acc!r}")
            out.update(status="ok", val_acc=acc, loss_curve=info.get("loss_curve"),
                       features=info.get("features"))
        except (OSError, ValueError, KeyError) as e:
            out["error"] = f"no usable result: {e}"
    return out


# -------------------------------------------------------------------------- 5. evaluate

def evaluate(val_acc, best_acc):
    """Acceptance rule: strictly greater. A tie keeps the old best."""
    return val_acc > best_acc


def screen(first_acc, best_first_acc, margin):
    """Multi-seed search, after the first seed: is the candidate worth the other seeds?
    Only a clear loss is dropped; a narrow one may be bad luck on this seed."""
    return first_acc >= best_first_acc - margin


# ---------------------------------------------------------------------------- 6. record

def record(log_path, entry):
    with open(log_path, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def load_history(log_path):
    with open(log_path, encoding="utf-8") as f:
        lines = [line for line in f if line.strip()]
    try:
        return [json.loads(line) for line in lines]
    except ValueError:  # the controller was stopped while writing the last line
        return [json.loads(line) for line in lines[:-1]]


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

    def code_of(run_id):
        path = baseline_copy if run_id == history[0]["id"] else os.path.join(runs_dir, run_id, "algorithm.py")
        return read_text(path) if os.path.exists(path) else None

    # Code that already has a score. Scores are deterministic, so running it again is a
    # guaranteed tie that would cost a full experiment.
    scored = {code_of(r["id"]): r["id"] for r in history if r["val_acc"] is not None}

    while len(history) - 1 < max_experiments:
        run_id = f"{next_run_number(runs_dir):03d}_loop"
        run_dir = os.path.join(runs_dir, run_id)
        os.makedirs(run_dir)
        log(f"[{run_id}] proposing (best = {best_id}, {best_acc:.4f})")

        p = propose(build_prompt(best_code, best_acc, history), llm)                     # 1
        write_text(os.path.join(run_dir, "prompt.txt"), p["prompt"])
        write_text(os.path.join(run_dir, "llm_reply.txt"), p["reply"])
        entry = {"id": run_id, "time": datetime.datetime.now().isoformat(timespec="seconds"),
                 "status": p["status"], "hypothesis": p["hypothesis"], "parent": best_id,
                 "val_acc": None, "best_before": best_acc, "seconds": None, "error": p["error"],
                 "pretrain_loss": None, "llm": p["llm"]}

        if p["code"] is not None:
            apply_edit(p["code"], best_code, best_id, run_dir, data_dir)                 # 2
            entry["error"] = validate(p["code"])                                         # 3
            if entry["error"] is None and p["code"] in scored:
                entry["error"] = (f"identical to the code of {scored[p['code']]}, which already "
                                  "has a score: not run again")
        if entry["error"] is None:
            result = run_experiment(run_dir, runner_cmd(run_dir), timeout_s)             # 4
            entry.update({k: v for k, v in result.items() if k not in ("loss_curve", "features")})
            changed = protected_files_changed(run_dir)
            if changed:  # the score cannot be trusted, whatever it is
                entry.update(status="invalid_patch", val_acc=None,
                             error="evaluator files changed during the run: " + ", ".join(changed))
            elif result["status"] == "ok":
                scored[p["code"]] = run_id
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


# ------------------------------------------------------------- multi-seed search loop

NOT_ACCEPTED = ("screened_out", "rejected", "crash", "timeout")  # a run was spent, no new best


def stuck_count(history):
    """How many candidates in a row used GPU time without becoming the new best.
    Proposals that were never run (invalid, LLM error) neither count nor reset it."""
    n = 0
    for r in reversed(history[1:]):
        if r["status"] == "accepted":
            break
        n += r["status"] in NOT_ACCEPTED
    return n


def blocked_category(history):
    """Category of the most recent candidate that was run and not accepted."""
    return next((r.get("category") for r in reversed(history[1:]) if r["status"] in NOT_ACCEPTED), None)


ASSIGNABLE = CATEGORIES[:4]  # 'other' is never assigned; this order breaks ties


def assigned_category(history, explore_every):
    """Fixed-share exploration: of every `explore_every` candidates that enter training, the
    last one must be in the category that has entered training least so far. Returns that
    category when the next candidate is such an assigned one, else None (free choice).
    Proposals that were refused before training neither count nor move the schedule."""
    if not explore_every:
        return None
    trained = [r for r in history[1:] if r.get("seconds") is not None]
    if len(trained) % explore_every != explore_every - 1:
        return None
    return min(ASSIGNABLE, key=lambda cat: sum(r.get("category") == cat for r in trained))


def run_search(baseline_dirs, llm, runner_cmd, runs_dir, state_dir, seeds, max_runs, max_experiments,
               timeout_s, screen_margin=0.01, explore_after=2, patience=5, data_dir=None, log=print,
               baseline_note="starting point of the search", explore_every=0):
    """The same six steps as run_loop, with three changes to the fixed rules:

    - evaluate: a candidate is trained on seeds[0] first (screen()); only if it is not
      clearly worse is it trained on the other seeds, and it is accepted only if its mean
      over all seeds is strictly greater than the best's mean over the same seeds;
    - propose: after `explore_after` candidates in a row without a new best, a proposal in
      the same category as the last failure is refused (explore instead of exploit);
      with `explore_every` = N > 0 that rule is off and instead every Nth candidate that
      enters training must be in the least-trained category (assigned_category());
    - stop: at `max_runs` training runs, `max_experiments` proposals, `patience` candidates
      in a row without a new best, or three failed LLM calls in a row.

    baseline_dirs: finished runs of ONE algorithm.py, one per seed (local_eval.json names
    the seed). Restarting with the same state_dir resumes. Returns (history, stop reason)."""
    os.makedirs(runs_dir, exist_ok=True)
    keys = [str(x) for x in seeds]
    log_path = os.path.join(state_dir, "runs.jsonl")
    baseline_copy = os.path.join(state_dir, "baseline", "algorithm.py")
    best_path = os.path.join(state_dir, "best", "algorithm.py")

    if not os.path.exists(log_path):  # first start: the given runs are the initial best
        infos = {str(json.loads(read_text(os.path.join(d, "local_eval.json")))["seed"]): d for d in baseline_dirs}
        if sorted(infos) != sorted(keys):
            raise SystemExit(f"baseline runs cover seeds {sorted(infos)}, need {sorted(keys)}")
        codes = {read_text(os.path.join(d, "algorithm.py")) for d in baseline_dirs}
        if len(codes) != 1:
            raise SystemExit("the baseline runs do not all use the same algorithm.py")
        scores = {k: json.loads(read_text(os.path.join(infos[k], "local_eval.json")))["val_acc"] for k in keys}
        os.makedirs(os.path.dirname(baseline_copy))
        os.makedirs(os.path.dirname(best_path))
        write_text(baseline_copy, codes.pop())
        base_id = os.path.basename(os.path.normpath(infos[keys[0]]))
        record(log_path, {
            "id": base_id, "time": datetime.datetime.now().isoformat(timespec="seconds"),
            "status": "baseline", "hypothesis": baseline_note, "parent": None,
            "category": None, "basis": None, "scores": scores, "val_acc": statistics.mean(scores.values()),
            "best_before": None, "best_after": statistics.mean(scores.values()), "best_id": base_id,
            "seconds": None, "error": None, "runs_used": 0,
            "pretrain_loss": pretrain_loss(os.path.join(infos[keys[0]], "stdout.log"))
            if os.path.exists(os.path.join(infos[keys[0]], "stdout.log")) else None,
            "source_runs": {k: os.path.basename(os.path.normpath(infos[k])) for k in keys}})

    history = load_history(log_path)

    def code_of(run_id):
        path = baseline_copy if run_id == history[0]["id"] else os.path.join(runs_dir, run_id, "algorithm.py")
        return read_text(path) if os.path.exists(path) else None

    best_id = history[-1]["best_id"]
    best = next(r for r in history if r["id"] == best_id)
    best_code = code_of(best_id)
    write_text(best_path, best_code)  # the log is the source of truth
    runs_used = history[-1].get("runs_used", 0)
    scored = {code_of(r["id"]): r["id"] for r in history if r.get("scores")}

    while True:
        stuck = stuck_count(history)
        llm_failures = 0
        for r in reversed(history[1:]):
            if r["status"] != "llm_error":
                break
            llm_failures += 1
        if len(history) - 1 >= max_experiments:
            reason = f"proposal limit reached ({max_experiments})"
        elif runs_used + len(keys) > max_runs:
            reason = f"run budget reached ({runs_used} of {max_runs} used; a candidate needs up to {len(keys)})"
        elif stuck >= patience:
            reason = f"no new best in the last {stuck} candidates that were run (patience {patience})"
        elif llm_failures >= 3:
            reason = "three LLM calls in a row failed"
        else:
            reason = None
        if reason:
            break

        run_id = f"{next_run_number(runs_dir):03d}_loop"
        run_dir = os.path.join(runs_dir, run_id)
        os.makedirs(run_dir)
        assigned = assigned_category(history, explore_every)
        after = float("inf") if explore_every else explore_after  # fixed share replaces explore-when-stuck
        log(f"[{run_id}] proposing (best = {best_id}, mean {best['val_acc']:.4f}, "
            f"runs used {runs_used}/{max_runs}, stuck {stuck})" +
            (f" [{'assigned: ' + assigned if assigned else 'free'}]" if explore_every else ""))

        prompt = build_search_prompt(best_code, history, seeds, screen_margin, stuck, after, timeout_s,
                                     assigned, explore_every)
        p = propose(prompt, llm)                                                         # 1
        write_text(os.path.join(run_dir, "prompt.txt"), p["prompt"])
        write_text(os.path.join(run_dir, "llm_reply.txt"), p["reply"])
        entry = {"id": run_id, "time": datetime.datetime.now().isoformat(timespec="seconds"),
                 "status": p["status"], "hypothesis": p["hypothesis"], "parent": best_id,
                 "category": p["category"], "basis": p["basis"], "scores": {}, "val_acc": None,
                 "best_before": best["val_acc"], "seconds": None, "error": p["error"],
                 "changes": None, "loss_curve": None, "features": None, "pretrain_loss": None,
                 "explore": stuck >= after, "llm": p["llm"]}
        if explore_every:
            entry["task"] = {"kind": "assigned" if assigned else "free", "category": assigned}

        if p["code"] is not None:
            apply_edit(p["code"], best_code, best_id, run_dir, data_dir, workdir=False)  # 2
            entry["changes"] = code_changes(best_code, p["code"])
            entry["error"] = validate(p["code"])                                         # 3
            if entry["error"] is None and p["code"] in scored:
                entry["error"] = (f"identical to the code of {scored[p['code']]}, which already "
                                  "has a score: not run again")
            if entry["error"] is None and entry["explore"] and p["category"] == blocked_category(history):
                entry["error"] = (f"explore rule: the last {stuck} candidates that were run were not accepted, "
                                  f"so a proposal in category '{p['category']}' is refused this round")
            if entry["error"] is None and assigned and p["category"] != assigned:
                entry["error"] = (f"assigned category: this proposal had to be in category '{assigned}', "
                                  f"so a proposal in category '{p['category']}' is refused this round")
        if entry["error"] is None:
            seconds = 0.0
            for i, k in enumerate(keys):
                workdir = os.path.join(run_dir, f"s{k}")
                prepare_workdir(p["code"], workdir, data_dir)
                result = run_experiment(workdir, runner_cmd(workdir, int(k)), timeout_s)  # 4
                runs_used += 1
                seconds += result["seconds"]
                changed = protected_files_changed(workdir)
                if changed:  # the score cannot be trusted, whatever it is
                    entry.update(status="invalid_patch",
                                 error="evaluator files changed during the run: " + ", ".join(changed))
                    break
                if result["status"] != "ok":
                    entry.update(status=result["status"], error=f"seed {k}: {result['error']}")
                    if i == 0:
                        entry["pretrain_loss"] = result["pretrain_loss"]
                    break
                entry["scores"][k] = result["val_acc"]
                log(f"[{run_id}] seed {k}: {result['val_acc']:.4f} (best has {best['scores'][k]:.4f})")
                if i == 0:
                    entry.update(loss_curve=result.get("loss_curve"), features=result.get("features"),
                                 pretrain_loss=result["pretrain_loss"])
                    if not screen(result["val_acc"], best["scores"][k], screen_margin):  # 5a
                        entry["status"] = "screened_out"
                        break
            else:
                entry["val_acc"] = statistics.mean(entry["scores"].values())
                accepted = evaluate(entry["val_acc"], best["val_acc"])                   # 5b
                entry["status"] = "accepted" if accepted else "rejected"
            entry["seconds"] = round(seconds, 1)
            if entry["scores"]:
                scored[p["code"]] = run_id

        if entry["status"] == "accepted":
            best_id, best, best_code = run_id, entry, p["code"]
            write_text(best_path, best_code)
        entry.update(best_after=best["val_acc"], best_id=best_id, runs_used=runs_used)
        record(log_path, entry)                                                          # 6
        history.append(entry)
        acc = "" if entry["val_acc"] is None else f" mean={entry['val_acc']:.4f}"
        log(f"[{run_id}] {entry['status']}{acc}" +
            (f" | {entry['error'].splitlines()[-1]}" if entry["error"] else ""))

    log(f"stopped: {reason}")
    write_text(os.path.join(state_dir, "stop_reason.txt"), reason + "\n")
    return history, reason


# ------------------------------------------------- fake LLM + fake evaluator (no GPU/key)

def fake_eval(workdir):
    """Stands in for local_eval.py. Obeys a '# FAKE_RUN: ...' line in algorithm.py:
    acc=0.185 -> report that accuracy, crash -> raise, sleep=30 -> hang for 30 s."""
    m = FAKE_MARKER.search(read_text(os.path.join(workdir, "algorithm.py")))
    action = m.group(1) if m else "acc=0.17"
    # multi-seed search: the folder is .../sNN; 'acc=42:0.19,43:0.2' and 'crash@43' pick by seed
    seed = os.path.basename(os.path.normpath(workdir))[1:]
    if action.startswith("crash@"):
        action = "crash" if action == f"crash@{seed}" else "acc=0.21"
    if action.startswith("acc=") and ":" in action:
        action = "acc=" + dict(x.split(":") for x in action[4:].split(","))[seed]
    if action == "crash":
        raise RuntimeError("fake crash: CUDA out of memory")
    if action.startswith("sleep="):
        time.sleep(float(action[6:]))
        action = "acc=0.17"
    with open(os.path.join(workdir, "local_eval.json"), "w") as f:
        json.dump({"val_acc": float(action[4:]), "fake": True}, f)


def fake_runner_cmd(run_dir, seed=None):
    return [sys.executable, os.path.abspath(__file__), "--fake-eval", run_dir]


def real_runner_cmd(run_dir, seed=None):
    return [sys.executable, LOCAL_EVAL, "--workdir", run_dir] + ([] if seed is None else ["--seed", str(seed)])


def with_marker(code, action):
    return f"# FAKE_RUN: {action}\n" + FAKE_MARKER.sub("", code).lstrip("\n")


# (hypothesis, function best_code -> candidate code). Baseline accuracy in fake mode is 0.1701.
FAKE_SCRIPT = [
    ("fake: better result", lambda c: with_marker(c, "acc=0.1850")),             # accepted
    ("fake: syntax error", lambda c: c + "\ndef broken(:\n"),                    # invalid_patch
    ("fake: crashes", lambda c: with_marker(c, "crash")),                        # crash
    ("fake: hangs", lambda c: with_marker(c, "sleep=60")),                       # timeout
    ("fake: worse result", lambda c: with_marker(c, "acc=0.1600")),              # rejected
    ("fake: ties the best", lambda c: with_marker(c, "acc=0.1850") + "# other code\n"),  # rejected (tie)
    ("fake: same code again", lambda c: c),                                      # invalid_patch (duplicate)
    ("fake: better again", lambda c: with_marker(c, "acc=0.1900")),              # accepted
]


class ScriptedLLM:
    """Plays a fixed script, but through the same prompt -> reply text path as a real LLM:
    it reads the best code out of the prompt and answers in the required reply format."""

    meta = {"model": "scripted-fake"}

    def __init__(self, script):
        self.script, self.prompts = script, []

    def __call__(self, prompt):
        hypothesis, edit, *category = self.script[len(self.prompts) % len(self.script)]
        self.prompts.append(prompt)
        best_code = CODE_BLOCK.findall(prompt)[-1]
        tags = f"CATEGORY: {category[0]}\nBASIS: known - scripted\n" if category else ""
        return f"HYPOTHESIS: {hypothesis}\n{tags}```python\n{edit(best_code)}```\n"


# Multi-seed fake script. The fake baseline scores 0.20 on every seed.
FAKE_SEARCH_SCRIPT = [
    ("fake: clearly worse on the first seed", lambda c: with_marker(c, "acc=0.15"), "augmentation"),     # screened_out
    ("fake: good on the first seed only", lambda c: with_marker(c, "acc=42:0.24,43:0.15,44:0.15"), "augmentation"),  # rejected
    ("fake: same category while stuck", lambda c: with_marker(c, "acc=0.30"), "augmentation"),           # refused (explore)
    ("fake: other category, better on average", lambda c: with_marker(c, "acc=42:0.195,43:0.23,44:0.22"), "loss"),  # accepted
    ("fake: crashes on the second seed", lambda c: with_marker(c, "crash@43"), "architecture"),          # crash
]


# ------------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--max-experiments", type=int, default=None,
                    help="total number of candidates in the log (invalid proposals count); "
                         "default 3, or 40 with --seeds")
    ap.add_argument("--seeds", default=None,
                    help="multi-seed search, e.g. 42,43,44: screen on the first seed, confirm on all")
    ap.add_argument("--max-runs", type=int, default=23, help="with --seeds: limit on training runs")
    ap.add_argument("--screen-margin", type=float, default=0.01,
                    help="with --seeds: drop a candidate that is this far below the best on the first seed")
    ap.add_argument("--explore-after", type=int, default=2,
                    help="with --seeds: after this many candidates without a new best, require another category")
    ap.add_argument("--explore-every", type=int, default=0,
                    help="with --seeds: N > 0 makes every Nth trained candidate an assigned one (least-trained "
                         "category) and turns --explore-after off; state goes to loop_explore/ by default")
    ap.add_argument("--patience", type=int, default=5,
                    help="with --seeds: stop after this many candidates in a row without a new best")
    ap.add_argument("--baseline-note", default="starting point of the search",
                    help="with --seeds: what the LLM is told about how the starting point was found")
    ap.add_argument("--baseline-dirs", nargs="+", default=None,
                    help="with --seeds: finished runs of the starting algorithm.py, one per seed")
    ap.add_argument("--timeout-min", type=float, default=40,
                    help="time limit per experiment (the baseline takes about 26 min)")
    ap.add_argument("--model", default="claude-opus-5-5", help="model passed to `claude --model`")
    ap.add_argument("--effort", default="medium", help="reasoning effort passed to `claude --effort`")
    ap.add_argument("--baseline-dir", default=os.path.join(ROOT, "runs", "003_det_s42"),
                    help="finished baseline run: algorithm.py + local_eval.json")
    ap.add_argument("--runs-dir", default=os.path.join(ROOT, "runs"))
    ap.add_argument("--state-dir", default=None, help="default: loop/, or loop_multiseed/ with --seeds")
    ap.add_argument("--fake", action="store_true",
                    help="scripted LLM + fake evaluator in a temp folder (no GPU, no LLM call)")
    ap.add_argument("--fake-eval", metavar="WORKDIR", help=argparse.SUPPRESS)
    args = ap.parse_args()
    sys.stdout.reconfigure(errors="replace")

    if args.fake_eval:
        return fake_eval(args.fake_eval)

    if args.seeds:
        return main_search(args)
    args.max_experiments = args.max_experiments or 3
    args.state_dir = args.state_dir or os.path.join(ROOT, "loop")

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
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)  # fresh clone: no download yet
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


def main_search(args):
    seeds = [int(x) for x in args.seeds.split(",")]
    common = dict(seeds=seeds, max_runs=args.max_runs, max_experiments=args.max_experiments or 40,
                  screen_margin=args.screen_margin, explore_after=args.explore_after, patience=args.patience,
                  explore_every=args.explore_every)
    if args.explore_every < 0:
        raise SystemExit("--explore-every must be 0 (off) or a positive number")
    if args.fake:
        tmp = tempfile.mkdtemp(prefix="controller_fake_")
        dirs = []
        for seed in seeds:  # a fake finished baseline run per seed
            d = os.path.join(tmp, "runs", f"00{seeds.index(seed)}_base_s{seed}")
            os.makedirs(d)
            shutil.copyfile(os.path.join(TASK_DIR, "algorithm.py"), os.path.join(d, "algorithm.py"))
            write_text(os.path.join(d, "local_eval.json"), json.dumps({"val_acc": 0.20, "seed": seed}))
            dirs.append(d)
        history, reason = run_search(dirs, ScriptedLLM(FAKE_SEARCH_SCRIPT), fake_runner_cmd,
                                     os.path.join(tmp, "runs"), os.path.join(tmp, "loop"), timeout_s=20, **common)
        print(f"output: {tmp}")
    else:
        os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
        dirs = args.baseline_dirs or [os.path.join(ROOT, "runs", n) for n in
                                      ("009_loop", "010_best009_s43", "011_best009_s44")]
        history, reason = run_search(
            [os.path.abspath(d) for d in dirs], ClaudeCLI(args.model, args.effort), real_runner_cmd,
            os.path.abspath(args.runs_dir), os.path.abspath(args.state_dir or os.path.join(
                ROOT, "loop_explore" if args.explore_every else "loop_multiseed")),
            timeout_s=args.timeout_min * 60, data_dir=os.path.join(ROOT, "data"),
            baseline_note=args.baseline_note, **common)

    print(f"\nstopped: {reason}")
    print("id            status         category       " + "  ".join(f"s{x:<5}" for x in seeds) + "  mean    best")
    for r in history:
        cells = "  ".join(f"{r['scores'][str(x)]:.4f}" if str(x) in r["scores"] else "  -   " for x in seeds)
        mean = "  -   " if r["val_acc"] is None else f"{r['val_acc']:.4f}"
        print(f"{r['id']:<13} {r['status']:<14} {(r.get('category') or '-'):<14} {cells}  {mean}  {r['best_after']:.4f}")


if __name__ == "__main__":
    main()
