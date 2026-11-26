"""Draw the two figures in docs/ (standard library only, output is SVG).

    python tools/make_figures.py            # writes docs/timeline.svg and docs/architecture.svg
    python tools/make_figures.py --png      # also PNG copies, using headless Edge or Chrome

timeline.svg is built entirely from the real log: loop/runs.jsonl plus, for each run,
runs/<id>/algorithm.py, prompt.txt and local_eval.json. Nothing in it is typed by hand,
so re-running the script after more experiments redraws it with the new columns.

architecture.svg is a fixed drawing of controller.py; the function names in it are checked
against controller.py so the figure cannot silently go out of date.
"""
import argparse
import ast
import difflib
import html
import io
import json
import math
import os
import re
import shutil
import subprocess
import textwrap
import tokenize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")

# Colours: neutral surface and inks, one blue for "LLM", reserved status colours.
SURFACE, INK, INK2, MUTED, GRID, AXIS = "#fcfcfb", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
LLM_FILL, LLM_EDGE = "#cde2fb", "#2a78d6"
RULE_FILL, RULE_EDGE = "#f0efec", "#c3c2b7"
SERIES = "#2a78d6"
GOOD, SERIOUS, CRITICAL = "#0ca30c", "#ec835a", "#d03b3b"
SANS = "Segoe UI, Helvetica, Arial, sans-serif"
MONO = "Consolas, Menlo, monospace"

# status -> (icon, wording, colour). The icon and wording carry the meaning, not the colour.
STATUS = {
    "baseline": ("●", "starting point", MUTED),
    "accepted": ("✓", "accepted: new best", GOOD),
    "rejected": ("✕", "rejected: best unchanged", CRITICAL),
    "invalid_patch": ("!", "invalid patch: not run", SERIOUS),
    "crash": ("!", "crashed: best unchanged", SERIOUS),
    "timeout": ("!", "timed out: best unchanged", SERIOUS),
    "llm_error": ("!", "LLM call failed", SERIOUS),
}


class Svg:
    def __init__(self, width, height):
        self.w, self.h = width, height
        self.parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" font-family="{SANS}">',
            '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{INK2}"/>'
            '</marker></defs>',
            f'<rect width="{width}" height="{height}" fill="{SURFACE}"/>']

    def rect(self, x, y, w, h, fill, stroke="none", rx=6, sw=1, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" '
                          f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}/>')

    def text(self, x, y, s, size=12, fill=INK, weight="normal", anchor="start", mono=False):
        fam = f' font-family="{MONO}"' if mono else ""
        self.parts.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" '
                          f'font-weight="{weight}" text-anchor="{anchor}"{fam} '
                          f'xml:space="preserve">{html.escape(s)}</text>')

    def lines(self, x, y, rows, size=12, gap=None, **kw):
        """Draw several lines of text; returns the y after the last one."""
        gap = gap or round(size * 1.35)
        for i, s in enumerate(rows):
            self.text(x, y + i * gap, s, size, **kw)
        return y + len(rows) * gap

    def path(self, points, stroke=INK2, sw=1.5, arrow=False, dash=None):
        d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in points)
        extra = (' marker-end="url(#arrow)"' if arrow else "") + (f' stroke-dasharray="{dash}"' if dash else "")
        self.parts.append(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" '
                          f'stroke-linejoin="round" stroke-linecap="round"{extra}/>')

    def circle(self, x, y, r, fill, stroke="none", sw=2):
        self.parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{fill}" stroke="{stroke}" '
                          f'stroke-width="{sw}"/>')

    def save(self, path):
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(self.parts + ["</svg>"]) + "\n")
        print("wrote", os.path.relpath(path, ROOT))


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def legend(svg, x, y):
    """The two kinds of box used in both figures."""
    svg.rect(x, y - 11, 14, 14, LLM_FILL, LLM_EDGE, rx=3)
    svg.text(x + 20, y, "LLM decision", 12, INK2)
    svg.rect(x + 110, y - 11, 14, 14, RULE_FILL, RULE_EDGE, rx=3)
    svg.text(x + 130, y, "fixed program rule (controller.py)", 12, INK2)


# ------------------------------------------------------------------------- timeline

def code_lines(source):
    """The lines of real code: no blank lines, comments or docstrings."""
    skip, comment_at = set(), {}
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            first = node.body[0] if node.body else None
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
                    and isinstance(first.value.value, str):
                skip.update(range(first.lineno, first.end_lineno + 1))
    for tok in tokenize.generate_tokens(io.StringIO(source).readline):
        if tok.type == tokenize.COMMENT:
            comment_at[tok.start[0]] = tok.start[1]
    lines = []
    for number, line in enumerate(source.splitlines(), 1):
        line = line[:comment_at.get(number, len(line))].strip()
        if line and number not in skip:
            lines.append(line)
    return lines


def code_changes(parent_path, child_path):
    """Changed code lines between two versions, leaving out comments and docstrings."""
    diff = difflib.unified_diff(code_lines(read(parent_path)), code_lines(read(child_path)), n=0, lineterm="")
    return [(line[0], line[1:]) for line in diff
            if line[:1] in "+-" and not line.startswith(("+++", "---"))]


def load_runs(state_dir, runs_dir):
    """runs.jsonl plus what each run directory adds: code change, budget, what the prompt saw."""
    runs = [json.loads(line) for line in read(os.path.join(state_dir, "runs.jsonl")).splitlines() if line.strip()]
    ids = [r["id"] for r in runs]
    for r in runs:
        run_dir = os.path.join(runs_dir, r["id"])
        code_path = os.path.join(run_dir, "algorithm.py")
        r["changes"] = None
        if r["parent"] and os.path.exists(code_path):
            parent_path = (os.path.join(state_dir, "baseline", "algorithm.py") if r["parent"] == ids[0]
                           else os.path.join(runs_dir, r["parent"], "algorithm.py"))
            try:
                r["changes"] = code_changes(parent_path, code_path)
            except SyntaxError:
                pass
        info_path = os.path.join(run_dir, "local_eval.json")
        r["info"] = json.loads(read(info_path)) if os.path.exists(info_path) else None
        prompt_path = os.path.join(run_dir, "prompt.txt")
        prompt = read(prompt_path) if os.path.exists(prompt_path) else ""
        history = prompt.split("Experiments so far")[-1].split("Current best algorithm.py")[0]
        r["saw"] = [i for i in ids if re.search(rf"^- {re.escape(i)} \[", history, re.MULTILINE)]
    return runs


def pct(x):
    return f"{100 * x:.2f}%"


def wrap_code(changes, width, max_rows):
    def split(text, limit):  # break after a space or punctuation, not in the middle of a name
        out = []
        while len(text) > limit:
            cut = max(text.rfind(ch, 0, limit) for ch in " .,([=") + 1
            cut = cut if cut > limit // 2 else limit
            out.append(text[:cut].rstrip())
            text = text[cut:].lstrip()
        return out + [text]

    rows = []
    for sign, text in changes:
        chunk = split(text, width - 2)
        if len(chunk) > 2:
            chunk = [chunk[0], chunk[1][:width - 5] + "..."]
        rows += [("−" if sign == "-" else "+") + " " + chunk[0]] + ["  " + c for c in chunk[1:]]
    if len(rows) > max_rows:
        rows = rows[:max_rows - 1] + [f"  ... {len(changes)} changed lines in total"]
    return rows


def run_lines(r):
    """What the fixed checks and the runner did with this candidate."""
    info, mins = r["info"], (f"{r['seconds'] / 60:.1f} min" if r["seconds"] else None)
    budget = (f"seed {info['seed']}, {info['budget']['pretrain_epochs']} pretrain epochs"
              if info and "budget" in info else None)
    if r["status"] == "baseline":
        mins = f"{info['seconds'] / 60:.1f} min" if info else None
        return [x for x in ("run before the loop started", f"local_eval.py: {mins}" if mins else None, budget) if x]
    if r["status"] == "llm_error":
        return ["no reply from the LLM, nothing to run"]
    if r["status"] == "invalid_patch":
        return ["validate(): refused", "not run, no GPU time spent"]
    out = ["validate(): passed"]
    if r["status"] in ("crash", "timeout"):
        return out + [f"run_experiment(): {r['status']}" + (f" after {mins}" if mins else "")]
    return out + [f"run_experiment(): {mins}"] + ([budget] if budget else [])


def draw_timeline(state_dir, runs_dir, out_path):
    runs = load_runs(state_dir, runs_dir)
    n, gutter, cw, gap, pad = len(runs), 168, 270, 34, 12
    chars = 41
    col_x = [gutter + i * (cw + gap) for i in range(n)]
    width = gutter + n * (cw + gap) + 6

    # Text of every cell first, so the row heights fit the longest one.
    hyp, code, checks, verdict = [], [], [], []
    for r in runs:
        if r["status"] == "baseline":
            hyp.append(["(no proposal: the unmodified", "official algorithm.py)"])
            code.append(["(no change)"])
        else:
            hyp.append(textwrap.wrap(r["hypothesis"] or "(no hypothesis in the reply)", chars))
            code.append(wrap_code(r["changes"], chars - 1, 12) if r["changes"] else
                        ["(no code change)" if r["changes"] == [] else "(no usable code in the reply)"])
        checks.append(run_lines(r))
        if r["status"] == "baseline":
            verdict.append([f"val_acc {pct(r['val_acc'])}", "becomes the initial best"])
        elif r["val_acc"] is not None:
            sign = ">" if r["val_acc"] > r["best_before"] else ("=" if r["val_acc"] == r["best_before"] else "<")
            verdict.append([f"val_acc {pct(r['val_acc'])} {sign} best {pct(r['best_before'])}",
                            "rule: accept only if strictly greater"])
        else:
            verdict.append(textwrap.wrap((r["error"] or "").strip().splitlines()[-1] if r["error"] else "", chars)[:3])

    chart_top, chart_h = 78, 170
    head_y = chart_top + chart_h + 46
    row_h = [max(len(c) for c in hyp) * 16 + 62, max(len(c) for c in code) * 15 + 26,
             max(len(c) for c in checks) * 16 + 20, max(len(c) for c in verdict) * 16 + 46]
    row_y = [head_y + 22]
    for h in row_h[:-1]:
        row_y.append(row_y[-1] + h + 14)
    height = row_y[-1] + row_h[-1] + 58
    svg = Svg(width, height)

    svg.text(20, 32, "What the loop did: every proposal, code change, run and decision, from the real log", 18,
             weight="600")
    svg.text(20, 54, "Barlow Twins on CIFAR-100, validation accuracy of a linear probe. One column per experiment, "
             "in the order they ran.", 13, INK2)

    # --- chart: one dot per experiment, a step line for the best so far
    accs = [r["val_acc"] for r in runs if r["val_acc"] is not None] + [r["best_after"] for r in runs]
    lo, hi = math.floor(min(accs) * 100) - 1, math.ceil(max(accs) * 100) + 1
    step = 1 if hi - lo <= 5 else 2

    def ypos(acc):
        return chart_top + chart_h - (acc * 100 - lo) / (hi - lo) * chart_h

    for tick in range(lo + (-lo % step), hi + 1, step):
        svg.path([(gutter - 6, ypos(tick / 100)), (width - 6, ypos(tick / 100))], GRID, 1)
        svg.text(gutter - 12, ypos(tick / 100) + 4, f"{tick}%", 12, MUTED, anchor="end")
    svg.text(20, chart_top + 14, "Validation", 13, weight="600")
    svg.text(20, chart_top + 31, "accuracy", 13, weight="600")
    svg.path([(20, chart_top + 52), (44, chart_top + 52)], SERIES, 2)
    svg.text(50, chart_top + 56, "best so far", 12, INK2)
    svg.circle(32, chart_top + 74, 5, SERIES)
    svg.text(50, chart_top + 78, "became best", 12, INK2)
    svg.circle(32, chart_top + 96, 5, SURFACE, SERIES)
    svg.text(50, chart_top + 100, "did not", 12, INK2)

    best_line = []
    for i, r in enumerate(runs):
        left = col_x[i] - (gap / 2 if i else 0)
        right = col_x[i] + cw + (gap / 2 if i < n - 1 else 0)
        best_line += [(left, ypos(r["best_after"])), (right, ypos(r["best_after"]))]
    svg.path(best_line, SERIES, 2)
    for i, r in enumerate(runs):
        cx = col_x[i] + cw / 2
        if r["val_acc"] is None:
            svg.text(cx, chart_top + chart_h - 8, f"! {r['status']}: no score", 12, INK2, anchor="middle")
            continue
        is_best = r["best_id"] == r["id"]
        cy = ypos(r["val_acc"])
        svg.circle(cx, cy, 6, SERIES if is_best else SURFACE, SURFACE if is_best else SERIES)
        svg.text(cx, cy - 13 if is_best else cy + 22, pct(r["val_acc"]), 13, weight="600", anchor="middle")

    # --- row labels
    labels = [("1  Proposal", ["propose()"], True),
              ("2  Code change", ["saved by apply_edit()"], True),
              ("3-4  Check and run", ["validate()", "run_experiment()"], False),
              ("5  Decision", ["evaluate()"], False)]
    for (name, funcs, is_llm), y, h in zip(labels, row_y, row_h):
        svg.text(20, y + 20, name, 14, weight="600")
        y = svg.lines(20, y + 38, funcs, 11, gap=15, fill=INK2, mono=True)
        svg.rect(20, y - 4, 12, 12, LLM_FILL if is_llm else RULE_FILL, LLM_EDGE if is_llm else RULE_EDGE, rx=3)
        svg.text(38, y + 6, "LLM decision" if is_llm else "program rule", 12, INK2)

    # --- one column per experiment
    for i, r in enumerate(runs):
        x, tx = col_x[i], col_x[i] + pad
        llm_made = r["status"] != "baseline"
        svg.text(x, head_y, r["id"], 15, weight="600", mono=True)
        note = f"built on {r['parent']}" if r["parent"] else "baseline"
        svg.text(x + cw, head_y, f"{note}  ·  {r['time'][11:16]}", 12, INK2, anchor="end")

        fill, edge = (LLM_FILL, LLM_EDGE) if llm_made else (RULE_FILL, RULE_EDGE)
        svg.rect(x, row_y[0], cw, row_h[0], fill, edge)
        y = row_y[0] + 20
        if llm_made:
            model = (r.get("llm") or {}).get("model", "LLM")
            saw = [s.split("_")[0] for s in r["saw"]]
            saw = ", ".join(saw if len(saw) <= 5 else saw[:2] + ["..."] + saw[-2:]) or "none"
            svg.text(tx, y, f"written by {model}", 11, INK2)
            svg.text(tx, y + 15, f"its prompt showed the results of: {saw}", 11, INK2)
            y += 38
        svg.lines(tx, y, hyp[i], 12)

        svg.rect(x, row_y[1], cw, row_h[1], fill, edge)
        svg.lines(tx, row_y[1] + 22, code[i], 11, gap=15, mono=llm_made, fill=INK if llm_made else INK2)

        svg.rect(x, row_y[2], cw, row_h[2], RULE_FILL, RULE_EDGE)
        svg.lines(tx, row_y[2] + 22, checks[i], 12)

        svg.rect(x, row_y[3], cw, row_h[3], RULE_FILL, RULE_EDGE)
        y = svg.lines(tx, row_y[3] + 22, verdict[i], 12, fill=INK2)
        icon, words, colour = STATUS[r["status"]]
        svg.circle(tx + 8, y + 5, 9, colour)
        svg.text(tx + 8, y + 9.5, icon, 12, "#ffffff", weight="700", anchor="middle")
        svg.text(tx + 24, y + 10, words, 13, weight="600")

        # feedback: this result was in the prompt of the next proposal
        if i + 1 < n and r["id"] in runs[i + 1]["saw"]:
            mid, y_from, y_to = x + cw + gap / 2, row_y[3] + row_h[3] / 2, row_y[0] + 14
            svg.path([(x + cw + 2, y_from), (mid, y_from), (mid, y_to), (col_x[i + 1] - 3, y_to)], arrow=True)

    foot = row_y[3] + row_h[3] + 28
    svg.path([(20, foot - 4), (48, foot - 4)], arrow=True)
    svg.text(56, foot, "the result was written into the prompt of the next proposal (checked against prompt.txt)", 12, INK2)
    legend(svg, 640, foot)
    svg.text(20, foot + 20, "Source: loop/runs.jsonl and runs/<id>/. Code changes leave out comments and docstrings. "
             "Every score is one training run with one seed.", 12, MUTED)
    svg.save(out_path)


# --------------------------------------------------------------------- architecture

STEPS = [  # (number, component, function, is_llm, description lines)
    ("1", "LLM", "propose()", True, ["asks the LLM for one", "hypothesis and a full", "new algorithm.py"]),
    ("2", "Code editor", "apply_edit()", False, ["writes the candidate", "into its own run folder,", "saves the diff"]),
    ("3", "Static check", "validate()", False, ["syntax, required names,", "import allow-list, no file,", "dataset or seed access"]),
    ("4", "Experiment runner", "run_experiment()", False, ["separate process,", "40 min time limit,", "killed on timeout"]),
    ("5", "Acceptance rule", "evaluate()", False, ["accept only if", "val_acc > best", "(strictly greater)"]),
    ("6", "Recorder", "record()", False, ["appends the outcome,", "then the next round, up", "to --max-experiments"]),
]
OTHER_FUNCTIONS = ["build_prompt()", "parse_reply()", "ClaudeCLI", "protected_files_changed()", "kill_tree()"]


def draw_architecture(out_path):
    source = read(os.path.join(ROOT, "controller.py"))
    for name in [s[2] for s in STEPS] + OTHER_FUNCTIONS:
        ident = name.rstrip("()")
        assert re.search(rf"^(def|class) {ident}\b", source, re.MULTILINE), f"{name} is not in controller.py"

    svg = Svg(1280, 720)
    svg.text(40, 40, "Architecture: one round of the research loop", 20, weight="600")
    svg.text(40, 62, "The LLM only writes text. What is run, how it is scored and whether it is accepted "
             "are fixed rules in controller.py.", 13, INK2)
    legend(svg, 890, 40)

    x0, bw, gap, top, bh = 70, 172, 24, 150, 132
    xs = [x0 + i * (bw + gap) for i in range(6)]
    mid = [x + bw / 2 for x in xs]

    # failure rail: a failed step skips straight to record()
    rail = top - 28
    for i, label in ((0, "llm_error, invalid_patch"), (2, "invalid_patch"), (3, "crash, timeout")):
        svg.path([(mid[i], top), (mid[i], rail)], dash="4 3")
        svg.text(mid[i] + 8, rail + 17, label, 12, INK2)
    svg.path([(mid[0], rail), (mid[5], rail), (mid[5], top - 2)], arrow=True, dash="4 3")
    svg.text(mid[5] + 8, rail + 17, "failures", 12, INK2)
    svg.text(mid[4], rail - 8, "a failed step is recorded and the loop goes on", 12, INK2, anchor="middle")

    for (num, part, func, is_llm, desc), x in zip(STEPS, xs):
        svg.rect(x, top, bw, bh, LLM_FILL if is_llm else RULE_FILL, LLM_EDGE if is_llm else RULE_EDGE, sw=1.5)
        svg.text(x + 12, top + 22, f"{num}  {part}", 12, INK2, weight="600")
        svg.text(x + 12, top + 46, func, 16, weight="700", mono=True)
        svg.lines(x + 12, top + 70, desc, 12.5, gap=17, fill=INK)
    for i in range(5):
        svg.path([(xs[i] + bw + 3, top + bh / 2), (xs[i + 1] - 3, top + bh / 2)], sw=2, arrow=True)

    # the LLM itself
    ly = top + bh + 66
    svg.rect(xs[0], ly, bw, 92, LLM_FILL, LLM_EDGE, sw=1.5)
    svg.text(xs[0] + 12, ly + 22, "Claude Opus", 15, weight="700")
    svg.lines(xs[0] + 12, ly + 42, ["ClaudeCLI runs `claude -p`:", "text in, text out,", "no tools, no file access"], 12, gap=16)
    svg.path([(mid[0] - 30, top + bh + 3), (mid[0] - 30, ly - 3)], arrow=True)
    svg.path([(mid[0] + 30, ly - 3), (mid[0] + 30, top + bh + 3)], arrow=True)
    svg.text(mid[0] - 38, top + bh + 38, "prompt", 12, INK2, anchor="end")
    svg.text(mid[0] + 38, top + bh + 38, "reply", 12, INK2)

    # the evaluator
    ex, ew = xs[2] + 60, 372
    svg.rect(ex, ly, ew, 112, RULE_FILL, RULE_EDGE, sw=1.5)
    svg.text(ex + 12, ly + 22, "Evaluator", 15, weight="700")
    svg.text(ex + 12, ly + 42, "local_eval.py → task/train_eval_baseline.py", 12, INK2, mono=True)
    svg.lines(ex + 12, ly + 62, ["official evaluator, never edited: hashes checked before and",
                                 "after each run. Same budget (20 pretrain epochs) and seeds",
                                 "for all runs. Selection on the validation split, not on test."], 12, gap=16)
    svg.path([(mid[3] - 30, top + bh + 3), (mid[3] - 30, ly - 3)], arrow=True)
    svg.path([(mid[3] + 30, ly - 3), (mid[3] + 30, top + bh + 3)], arrow=True)
    svg.text(mid[3] - 38, top + bh + 38, "runs", 12, INK2, anchor="end")
    svg.text(mid[3] + 38, top + bh + 38, "val_acc", 12, INK2)

    # research memory
    my, mh = 522, 150
    svg.rect(40, my, 1200, mh, SURFACE, AXIS, sw=1.5)
    svg.text(56, my + 26, "Research memory", 15, weight="700")
    svg.text(190, my + 26, "plain files on disk, all kept in the repository", 12, INK2)
    items = [("loop/runs.jsonl", ["one line per experiment: status,", "val_acc, hypothesis, error,", "LLM model and cost"]),
             ("loop/best/algorithm.py", ["the current best; replaced", "only when a candidate", "is accepted"]),
             ("loop/baseline/algorithm.py", ["byte copy of the baseline,", "never overwritten"]),
             ("runs/NNN_loop/", ["prompt.txt, llm_reply.txt,", "algorithm.py, diff.patch,", "stdout.log, local_eval.json"])]
    for i, (name, desc) in enumerate(items):
        ix = 56 + i * 296
        svg.text(ix, my + 58, name, 13, weight="700", mono=True)
        svg.lines(ix, my + 78, desc, 12, gap=16, fill=INK2)

    # memory -> propose (next round), and what each step writes
    svg.path([(40, my + 40), (24, my + 40), (24, top + bh / 2), (xs[0] - 3, top + bh / 2)], sw=2, arrow=True)
    svg.lines(34, ly + 114, ["next round: best code +", "all past results and errors"], 12, gap=16, fill=INK2)
    for i, label in ((1, ["writes", "runs/NNN_loop/"]), (4, ["if accepted:", "new best"]), (5, ["appends", "one line"])):
        svg.path([(mid[i], top + bh + 3), (mid[i], my - 3)], arrow=True)
        svg.lines(mid[i] + 8, my - 36, label, 12, gap=16, fill=INK2)
    svg.save(out_path)


# ------------------------------------------------------------------------------ png

def to_png(svg_path, scale=2):
    """Optional: rasterise with a headless Chromium browser if one is installed."""
    names = ["msedge", "chrome", "chromium", "google-chrome"]
    fixed = [os.path.join(os.environ.get(v, ""), p) for v in ("ProgramFiles(x86)", "ProgramFiles")
             for p in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe")]
    browser = next((b for b in [shutil.which(n) for n in names] + fixed if b and os.path.exists(b)), None)
    if not browser:
        print("no Edge/Chrome found, skipped PNG for", os.path.basename(svg_path))
        return
    m = re.search(r'width="(\d+)" height="(\d+)"', read(svg_path))
    png = svg_path[:-4] + ".png"
    subprocess.run([browser, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    f"--force-device-scale-factor={scale}", f"--window-size={m.group(1)},{m.group(2)}",
                    f"--screenshot={png}", "file:///" + svg_path.replace(os.sep, "/")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    print("wrote", os.path.relpath(png, ROOT))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--state-dir", default=os.path.join(ROOT, "loop"))
    ap.add_argument("--runs-dir", default=os.path.join(ROOT, "runs"))
    ap.add_argument("--out-dir", default=DOCS)
    ap.add_argument("--png", action="store_true", help="also write PNG copies (needs Edge or Chrome)")
    args = ap.parse_args()
    out = [os.path.join(os.path.abspath(args.out_dir), name) for name in ("timeline.svg", "architecture.svg")]
    draw_timeline(os.path.abspath(args.state_dir), os.path.abspath(args.runs_dir), out[0])
    draw_architecture(out[1])
    if args.png:
        for path in out:
            to_png(path)


if __name__ == "__main__":
    main()
