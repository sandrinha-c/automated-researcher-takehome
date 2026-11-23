"""Reduced-compute local evaluator.

Runs the official FML-bench harness `train_eval_baseline.py` UNCHANGED, with one
deterministic override: the compute-budget keys returned by the candidate's
`get_training_config()` are replaced by the declared budget below. Every
experiment (baseline and candidates) therefore trains for the same budget,
whatever the LLM writes into algorithm.py. All other config keys (lr, lambda,
...) are left to the candidate.

Only `--split val` is exposed: the hidden test split is never used for selection.

Further deterministic controls (none of them edit the official file):
- `linear_lr` is also fixed: it belongs to the evaluation protocol (the linear
  probe), not to the representation being evaluated.
- PyTorch deterministic mode is on by default, so the same code and seed give
  bit-identical results (see tools/determinism_check.py).
- `--seed` replaces the harness's fixed seeds (global 42, linear probe 100) by
  (S, 100 + S - 42). The default S=42 reproduces the official seeds; other values
  are only used to measure seed-to-seed variation of the baseline.

Usage (from an experiment directory that contains algorithm.py,
train_eval_baseline.py and split_config.json):
    python local_eval.py --workdir runs/001_baseline --pretrain-epochs 20
"""
import argparse
import hashlib
import json
import os
import sys
import time

# Required by torch.use_deterministic_algorithms for cuBLAS; must be set before CUDA starts.
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

HERE = os.path.dirname(os.path.abspath(__file__))
OFFICIAL_HARNESS = os.path.join(HERE, "task", "train_eval_baseline.py")
OFFICIAL_SPLIT = os.path.join(HERE, "task", "split_config.json")

# Keys that define compute. Held fixed for every experiment.
DEFAULT_BUDGET = {
    "pretrain_epochs": 20,
    "linear_eval_epochs": 100,
    "batch_size": 512,
    "linear_batch_size": 256,
    "linear_lr": 0.1,
}


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workdir", required=True)
    ap.add_argument("--pretrain-epochs", type=int, default=DEFAULT_BUDGET["pretrain_epochs"])
    ap.add_argument("--linear-eval-epochs", type=int, default=DEFAULT_BUDGET["linear_eval_epochs"])
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--nondeterministic", action="store_true",
                    help="disable PyTorch deterministic mode (how runs 000-002 were made)")
    args = ap.parse_args()

    budget = dict(DEFAULT_BUDGET,
                  pretrain_epochs=args.pretrain_epochs,
                  linear_eval_epochs=args.linear_eval_epochs)

    workdir = os.path.abspath(args.workdir)
    # Integrity: the evaluator and the split config must be byte-identical to the official ones.
    for name, ref in (("train_eval_baseline.py", OFFICIAL_HARNESS), ("split_config.json", OFFICIAL_SPLIT)):
        got = os.path.join(workdir, name)
        if sha256(got) != sha256(ref):
            sys.exit(f"INTEGRITY: {name} in {workdir} differs from the official copy")

    os.chdir(workdir)
    sys.path.insert(0, workdir)
    import train_eval_baseline as harness  # imports the candidate's algorithm.py

    candidate_config = harness.get_training_config

    def budgeted_config():
        cfg = dict(candidate_config())
        cfg.update(budget)
        return cfg

    harness.get_training_config = budgeted_config

    deterministic = not args.nondeterministic
    if deterministic:
        harness.torch.backends.cudnn.deterministic = True
        harness.torch.backends.cudnn.benchmark = False
        harness.torch.use_deterministic_algorithms(True)

    seed = args.seed
    linear_seed = 100 + (seed - 42)
    if seed != 42:
        official_set_seed, official_linear_eval = harness.set_seed, harness.linear_eval
        harness.set_seed = lambda _s=42: official_set_seed(seed)
        harness.linear_eval = lambda *a, seed=None, **k: official_linear_eval(*a, seed=linear_seed, **k)

    print(f"LOCAL_EVAL budget={budget} seed={seed} linear_probe_seed={linear_seed} "
          f"deterministic={deterministic} (harness log lines showing seed=100 are overridden "
          f"when seed!=42)", flush=True)
    sys.argv = ["train_eval_baseline.py", "--split", "val"]

    t0 = time.time()
    harness.main()
    elapsed = time.time() - t0

    with open(os.path.join("results_tmp", "val_info.json")) as f:
        acc = json.load(f)["cifar100_ssl"]["means"]["linear_eval_acc_mean"]
    with open("local_eval.json", "w") as f:
        json.dump({"val_acc": acc, "budget": budget, "seconds": round(elapsed, 1),
                   "seed": seed, "linear_seed": linear_seed, "deterministic": deterministic,
                   "harness_sha256": sha256(OFFICIAL_HARNESS)}, f, indent=2)
    print(f"LOCAL_EVAL val_acc={acc:.6f} seconds={elapsed:.1f}")


if __name__ == "__main__":
    main()
