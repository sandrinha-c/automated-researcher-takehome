# Automated researcher — take-home

A minimal autonomous research loop (Propose → Modify → Execute → Evaluate → Record → Repeat)
on the FML-bench task `Representation_Learning_solo_learn` (Barlow Twins on CIFAR-100).

Work in progress: the visualization, Part 4 and the disclosure section will be added here.

## Environment

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 3060 Ti, 8 GB (driver 576.57) |
| CPU / RAM | AMD Ryzen 5 3600 (6 cores) / 32 GB |
| OS | Windows 10 Home 19045, run natively (no WSL) |
| Python env | conda `sololearn`: Python 3.10, torch 2.1.0+cu121, torchvision 0.16.0+cu121, numpy 1.26.4 — see [environment.yml](environment.yml) |

```
conda env create -f environment.yml
```

## Task source

[task/](task/) is a verbatim copy of FML-bench `ml_tasks/Representation_Learning_solo_learn`
at commit `d336651` (see [task/SOURCE.md](task/SOURCE.md)). The official evaluator
`task/train_eval_baseline.py` is never modified (SHA-256 `6a4f78b4…a1d682`).

## Reduced-compute local evaluator

The official config trains for 130 pretrain epochs (~2.7 h per experiment on this GPU).
[local_eval.py](local_eval.py) runs the official evaluator unchanged and overrides only the
compute-budget keys of `get_training_config()`, so the baseline and every candidate use the
same declared budget regardless of what the LLM writes:

| Budget key | Official | Declared (this repo) |
|---|---|---|
| `pretrain_epochs` | 130 | **20** |
| `linear_eval_epochs` | 100 | 100 |
| `batch_size` | 512 | 512 |
| `linear_batch_size` | 256 | 256 |

Fixed by the official evaluator: global seed 42, linear-probe seed 100, split
`val_ratio=0.057, val_seed=42` (49,979 train / 3,021 validation images). `local_eval.py`
refuses to run if `train_eval_baseline.py` or `split_config.json` differ from the official
copies, and only exposes `--split val`, so the 7,000 hidden test images are never used
for selection. Unlike FML-bench, the LLM is not allowed to edit `split_config.json`.

## Part 1 — baseline

### What the baseline does

**Barlow Twins (pretraining, no labels).** Every training image is randomly augmented
twice (crop, flip, colour jitter, grayscale, blur), giving two views of the same image.
Both views go through the same network: a ResNet-18 backbone (512-d features) followed
by a 3-layer projector (2048-d embeddings). Over a batch, the loss builds the
2048 × 2048 cross-correlation matrix between the embeddings of view 1 and view 2 and
pushes it towards the identity matrix:

- diagonal → 1: each embedding dimension gives the same answer for both views, so the
  representation ignores the augmentations and keeps what the image is about;
- off-diagonal → 0 (weighted by `lambda_param = 5e-3`): different dimensions carry
  different information, which prevents the trivial solution where every image gets
  the same output.

Unlike contrastive methods, it needs no negative pairs and no momentum encoder.
The code is in [task/algorithm.py](task/algorithm.py) (`BarlowTwinsLoss`, `BarlowTwinsModel`).

**Linear evaluation (the score).** Pretraining has no accuracy of its own, so the
quality of the representation is measured afterwards. The projector is discarded and the
backbone is frozen. A single linear layer (512 → 100 classes) is trained on the frozen
features with the training labels (SGD, lr 0.1, 100 epochs), and its accuracy on the
3,021 validation images is the reported number. A linear layer cannot learn new features,
so a higher accuracy means the backbone itself has organised the images better. This
protocol lives in the official evaluator (`linear_eval()` in `task/train_eval_baseline.py`)
and is the same for every experiment.

**One possible modification.** Lower the pretraining learning rate (`lr` 0.4 → 0.2 in
`get_training_config()`). Reason: the evaluator uses plain SGD with a cosine schedule and
no warmup, and the seed study below shows that two of three seeds end pretraining with
almost twice the loss of the third, which suggests unstable early training. A smaller
step size is the simplest change that targets this, it costs no extra compute, and it is
a one-line edit inside the file the loop is allowed to change. It is a hypothesis to
test, not a result.

### Baseline runs

```
python local_eval.py --workdir runs/001_baseline --pretrain-epochs 20
```

Each run directory holds copies of `algorithm.py`, `train_eval_baseline.py` and
`split_config.json`, plus a `data` junction to a shared CIFAR-100 download.

| Run | Code | Budget | Val accuracy | Wall time |
|---|---|---|---|---|
| [001_baseline](runs/001_baseline/) | unmodified `algorithm.py` | 20 ep | **18.80%** | 25.1 min |
| [002_baseline_repeat](runs/002_baseline_repeat/) | identical, same seeds | 20 ep | **17.51%** | 25.1 min |
| (official, reference only) | unmodified | 130 ep | 47.77% | — |

**Run-to-run noise.** Two identical runs differ by 1.29 percentage points; pretrain losses
already differ at epoch 1. [tools/determinism_check.py](tools/determinism_check.py) shows
why: input batches are bit-identical across runs (same data and augmentation), the first
loss is identical, and losses diverge from the second step, i.e. after the first
backward pass. Enabling PyTorch deterministic mode removes the difference.

### Deterministic mode and seed-to-seed variation

`local_eval.py` now runs in deterministic mode by default and accepts `--seed`
(seeds other than 42 are used only to measure variation, never for selection).

```
python local_eval.py --workdir runs/003_det_s42 --pretrain-epochs 20 --seed 42
```

| Run | Seed | Pretrain loss, epoch 20 | Val accuracy | Wall time |
|---|---|---|---|---|
| [003_det_s42](runs/003_det_s42/) | 42 | 745.94 | **17.01%** | 26.1 min |
| [004_det_s42_repeat](runs/004_det_s42_repeat/) | 42 | 745.94 | **17.01%** | 26.5 min |
| [005_det_s43](runs/005_det_s43/) | 43 | 1317.68 | **9.47%** | 26.1 min |
| [006_det_s44](runs/006_det_s44/) | 44 | 1422.32 | **9.53%** | 26.2 min |

- Runs 003 and 004 are bit-identical (same losses, accuracy and checkpoint SHA-256):
  deterministic mode makes the full experiment reproducible at ~4% extra wall time.
- Across seeds 42/43/44 the baseline gives 12.0% ± 4.3 pp (mean ± sample std, n=3).
  The gap appears in pretraining (much higher final loss for seeds 43/44), not in the
  linear probe. Our unverified hypothesis: lr 0.4 without warmup makes early training
  unstable for some initialisations, and seed 42 is a favourable one.
- For reference, the binomial standard error of an accuracy near 17% on 3,021
  validation images is about 0.7 pp.

**Consequence for the loop.** Selection uses seed 42 in deterministic mode, so
comparisons are exactly reproducible and follow the brief's "strictly exceeds under the
same conditions" rule. The initial best is `003_det_s42` (17.01%). Because seed-to-seed
variation (±4.3 pp) is far larger than run-to-run noise, an improvement found at seed 42
is not evidence that it holds for other seeds; this is the main limitation addressed in
Part 4.

Timing runs (1 and 2 epochs) are in [runs/000_timing](runs/000_timing/); the first one
includes the CIFAR-100 download.

Note: `001_baseline` ran with CRLF copies of the task files (a Windows checkout artifact,
fixed before `002`); Python executes them identically.

## Part 2 — the research loop

[controller.py](controller.py) runs the loop: propose → apply edit → validate → run →
evaluate → record. The LLM only writes the text of a new `algorithm.py`; what is run, how
it is scored and whether it is accepted are fixed rules in the controller.

```
python controller.py --max-experiments 3
```

This starts from `runs/003_det_s42` as the initial best and uses the same evaluator
command as Part 1 for every candidate (20 pretrain epochs, seed 42, deterministic mode).
One experiment takes about 26 minutes on this GPU. Restarting the command with the same
`loop/` folder resumes from the log.

### Result of the real run (2026-11-24)

| Run | Parent | Change proposed by the LLM | Val accuracy | Decision | Diff |
|---|---|---|---|---|---|
| [003_det_s42](runs/003_det_s42/) | — | unmodified baseline | 17.01% | initial best | — |
| [007_loop](runs/007_loop/) | 003 | remove `GaussianBlur` from the augmentation | **18.40%** | accepted | [diff](runs/007_loop/diff.patch) |
| [008_loop](runs/008_loop/) | 007 | raise the minimum crop scale 0.2 → 0.35 | 16.09% | rejected | [diff](runs/008_loop/diff.patch) |
| [009_loop](runs/009_loop/) | 007 | multiply the loss by 0.1 | **20.03%** | accepted | [diff](runs/009_loop/diff.patch) |

- The best moved from 17.01% to 20.03% in three experiments (77 minutes of GPU time,
  0.24 USD of LLM usage as reported by the command line).
- 008 was rejected, so 009 was proposed from 007 again, with the failed attempt and its
  score in the prompt. This is the "use the feedback for the next proposal" step.
- All three scores come from seed 42 only. The baseline alone varies by ±4.3 pp across
  seeds, so these gains are not yet shown to hold for other seeds (see Part 4).

Where to look:

| File | Content |
|---|---|
| [loop/runs.jsonl](loop/runs.jsonl) | one line per experiment: hypothesis, status, score, best before/after, model, token usage |
| `runs/NNN_loop/prompt.txt`, `llm_reply.txt` | the full prompt sent to the LLM and its unedited reply |
| `runs/NNN_loop/diff.patch`, `algorithm.py` | the change against its parent, and the candidate file |
| `runs/NNN_loop/stdout.log`, `local_eval.json` | evaluator output and score |
| [loop/baseline/](loop/baseline/), [loop/best/](loop/best/) | the untouched baseline and the current best `algorithm.py` |

### Reproducing

- **Without a GPU or an LLM:** `python controller.py --fake --max-experiments 7` plays a
  scripted "LLM" against a fake evaluator in a temporary folder and exercises every
  outcome (accepted, rejected, tie, invalid patch, crash, timeout).
  `python -m unittest test_controller -v` runs the unit tests (also no GPU, no LLM call).
- **Real run:** the LLM is called through the Claude Code command line, not through an
  API key. Install it (`npm install -g @anthropic-ai/claude-code`), run `claude` once and
  log in, then run the command above. Defaults: `--model claude-opus-5-5 --effort medium`
  (run made with Claude Code 2.1.330). LLM output is not deterministic, so a new run will
  produce different proposals; the experiments themselves are reproducible from the
  saved `algorithm.py` files.

### What the LLM sees

Each call is `claude -p` with all tools, MCP servers and slash commands switched off, a
one-line system prompt that replaces the default one, no saved session, and an empty
temporary folder as working directory. The intended context is therefore the system
prompt plus `prompt.txt`. Checked on 2026-11-25:

- No user-level `CLAUDE.md` exists on this machine, and the empty working folder has no
  project instructions. Claude Code's memory is stored per working folder, and no memory
  folder exists for the temporary folders the controller used.
- The command line still adds a short block of its own that is not in `prompt.txt`:
  operating system, working folder, date, model name, and a note with the account email.
  A test call with the same flags showed this block; it contains nothing about this
  project or earlier results.
- Not verified: whether a `CLAUDE.md` would be ignored if one existed. A test with a
  marker file was inconclusive, so on another machine check that `~/.claude/CLAUDE.md`
  is absent before a real run.
