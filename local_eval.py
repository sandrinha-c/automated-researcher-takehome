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
  are only used to measure seed-to-seed variation, never for selection.
- Python's `random` module is seeded with S too (the harness seeds only torch and numpy).

Diagnostics for the research loop (read-only, they do not change the result; `--plain`
switches them off, which is how that was checked):
- the mean pretrain loss of every epoch (the harness prints only epoch 1 and every 20th),
  recorded by a forward hook on the candidate's loss module;
- after the linear probe has been scored, two numbers about the frozen features of the
  validation images: their effective rank and their mean standard deviation per dimension.

Usage (from an experiment directory that contains algorithm.py,
train_eval_baseline.py and split_config.json):
    python local_eval.py --workdir runs/001_baseline --pretrain-epochs 20
"""
import argparse
import hashlib
import json
import os
import random
import sys
import time

# Required by torch.use_deterministic_algorithms for cuBLAS; must be set before CUDA starts.
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

HERE = os.path.dirname(os.path.abspath(__file__))
OFFICIAL_HARNESS = os.path.join(HERE, "task", "train_eval_baseline.py")
OFFICIAL_SPLIT = os.path.join(HERE, "task", "split_config.json")
# SHA-256 of the files at FML-bench commit d336651 (task/SOURCE.md). Pinned here so that an
# edit to task/ itself is caught too, not only a difference between a run copy and task/.
PINNED_SHA256 = {
    "train_eval_baseline.py": "6a4f78b42b40da3b9c39b6b5e4db587372623dba7b20f1b95ee64175a2a1d682",
    "split_config.json": "e5f83281234a2ffa594497fa6e42c38bc3cb7a326b846233c2774550128a7970",
}

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


def feature_stats(torch, model, loader, device):
    """Is the representation collapsed? Effective rank = exp(entropy of the normalised
    singular values) of the centred validation features: 1 = one direction, dim = all."""
    feats = []
    with torch.no_grad():
        for x, _ in loader:
            feats.append(model(x.to(device))[0].float().cpu())
    f = torch.cat(feats)
    if not bool(torch.isfinite(f).all()):
        return {"finite": False, "dim": int(f.shape[1])}
    f = f - f.mean(0)
    sv = torch.linalg.svdvals(f)
    prob = sv / sv.sum()
    prob = prob[prob > 0]
    return {"finite": True, "dim": int(f.shape[1]),
            "effective_rank": round(float(torch.exp(-(prob * prob.log()).sum())), 1),
            "mean_std": round(float(f.std(0).mean()), 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workdir", required=True)
    ap.add_argument("--pretrain-epochs", type=int, default=DEFAULT_BUDGET["pretrain_epochs"])
    ap.add_argument("--linear-eval-epochs", type=int, default=DEFAULT_BUDGET["linear_eval_epochs"])
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--nondeterministic", action="store_true",
                    help="disable PyTorch deterministic mode (how runs 000-002 were made)")
    ap.add_argument("--plain", action="store_true",
                    help="no loss-curve and feature diagnostics (to check they change nothing)")
    args = ap.parse_args()

    budget = dict(DEFAULT_BUDGET,
                  pretrain_epochs=args.pretrain_epochs,
                  linear_eval_epochs=args.linear_eval_epochs)

    workdir = os.path.abspath(args.workdir)
    # Integrity: the evaluator and the split config must be byte-identical to the official ones.
    for name, ref in (("train_eval_baseline.py", OFFICIAL_HARNESS), ("split_config.json", OFFICIAL_SPLIT)):
        got = os.path.join(workdir, name)
        if sha256(ref) != PINNED_SHA256[name]:
            sys.exit(f"INTEGRITY: task/{name} differs from the pinned FML-bench file")
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
    official_set_seed, official_linear_eval = harness.set_seed, harness.linear_eval
    if seed != 42:
        harness.set_seed = lambda _s=42: official_set_seed(seed)

    diag = {"losses": [], "features": None}

    def linear_eval(model, train_loader, eval_loader, config, device, seed=None):
        acc = official_linear_eval(model, train_loader, eval_loader, config, device, seed=linear_seed)
        if not args.plain:  # after the score exists, so it cannot influence it
            try:
                diag["features"] = feature_stats(harness.torch, model, eval_loader, device)
            except Exception as e:  # diagnostics must never cost a finished run
                diag["features"] = {"error": repr(e)[:200]}
        return acc

    harness.linear_eval = linear_eval

    if not args.plain:
        candidate_loss = harness.BarlowTwinsLoss

        def recording_loss(*a, **k):
            criterion = candidate_loss(*a, **k)
            try:
                criterion.register_forward_hook(lambda _m, _i, out: diag["losses"].append(out.detach()))
            except Exception:
                pass
            return criterion

        harness.BarlowTwinsLoss = recording_loss

    print(f"LOCAL_EVAL budget={budget} seed={seed} linear_probe_seed={linear_seed} "
          f"deterministic={deterministic} (harness log lines showing seed=100 are overridden "
          f"when seed!=42)", flush=True)
    sys.argv = ["train_eval_baseline.py", "--split", "val"]

    # The harness seeds torch and numpy only. Seed Python's `random` as well, so a candidate
    # that uses it in the main process still gives the same score for the same code.
    random.seed(seed)

    t0 = time.time()
    harness.main()
    elapsed = time.time() - t0

    with open(os.path.join("results_tmp", "val_info.json")) as f:
        acc = json.load(f)["cifar100_ssl"]["means"]["linear_eval_acc_mean"]

    loss_curve = None
    try:
        steps = [float(v) for v in diag["losses"]]
        epochs = budget["pretrain_epochs"]
        if steps and len(steps) % epochs == 0:
            per = len(steps) // epochs
            loss_curve = [round(sum(steps[i * per:(i + 1) * per]) / per, 4) for i in range(epochs)]
    except Exception:
        pass

    with open("local_eval.json", "w") as f:
        json.dump({"val_acc": acc, "budget": budget, "seconds": round(elapsed, 1),
                   "seed": seed, "linear_seed": linear_seed, "deterministic": deterministic,
                   "harness_sha256": sha256(OFFICIAL_HARNESS),
                   "loss_curve": loss_curve, "features": diag["features"]}, f, indent=2)
    print(f"LOCAL_EVAL val_acc={acc:.6f} seconds={elapsed:.1f}")


if __name__ == "__main__":
    main()
