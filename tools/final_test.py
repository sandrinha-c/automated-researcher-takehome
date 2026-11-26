"""Final report on the hidden test split. NOT part of the loop and never used for selection.

The loop selects on validation accuracy only (local_eval.py exposes no test option, and the
controller never calls this file). Selecting many candidates on one validation split makes
the validation score of the winner optimistic, so after all selection is finished this
script scores chosen runs once on the 7,000 held-out test images.

It runs the official `train_eval_baseline.py --split test` UNCHANGED in the run folder. That
mode loads the backbone saved by the validation run (model_checkpoint/backbone.pt, no new
pretraining), trains a new linear probe on the whole visible pool and evaluates it on the
hidden test images. The same controls as in local_eval.py apply: the budget keys recorded
for the validation run, deterministic mode, and for seed S the linear-probe seed
200 + (S - 42) (200 is the official test seed).

    python tools/final_test.py --selection-is-finished runs/003_det_s42 runs/009_loop

Writes test_eval.json next to local_eval.json in every run folder and prints a table.
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import local_eval as le  # noqa: E402  (pinned hashes, default budget; also sets CUBLAS_WORKSPACE_CONFIG)


def run_one(workdir):
    workdir = os.path.abspath(workdir)
    with open(os.path.join(workdir, "local_eval.json")) as f:
        val = json.load(f)
    seed = val["seed"]
    budget = dict(le.DEFAULT_BUDGET, **val["budget"])
    for name, ref in (("train_eval_baseline.py", le.OFFICIAL_HARNESS), ("split_config.json", le.OFFICIAL_SPLIT)):
        if le.sha256(ref) != le.PINNED_SHA256[name] or le.sha256(os.path.join(workdir, name)) != le.sha256(ref):
            sys.exit(f"INTEGRITY: {name} in {workdir} is not the official file")
    checkpoint = os.path.join(workdir, "model_checkpoint", "backbone.pt")
    if not os.path.exists(checkpoint):
        sys.exit(f"no checkpoint in {workdir}: the validation run must be repeated first")

    os.chdir(workdir)
    sys.path.insert(0, workdir)
    import train_eval_baseline as harness

    candidate_config = harness.get_training_config
    harness.get_training_config = lambda: dict(candidate_config(), **budget)
    harness.torch.backends.cudnn.deterministic = True
    harness.torch.backends.cudnn.benchmark = False
    harness.torch.use_deterministic_algorithms(True)

    linear_seed = 200 + (seed - 42)
    official_set_seed, official_linear_eval = harness.set_seed, harness.linear_eval
    harness.set_seed = lambda _s=42: official_set_seed(seed)
    harness.linear_eval = lambda *a, seed=None, **k: official_linear_eval(*a, seed=linear_seed, **k)

    sys.argv = ["train_eval_baseline.py", "--split", "test"]
    harness.main()
    with open(os.path.join("results_tmp", "test_info.json")) as f:
        acc = json.load(f)["cifar100_ssl"]["means"]["linear_eval_acc_mean"]
    with open("test_eval.json", "w") as f:
        json.dump({"test_acc": acc, "val_acc": val["val_acc"], "seed": seed, "linear_seed": linear_seed,
                   "budget": budget, "checkpoint_sha256": le.sha256(checkpoint),
                   "harness_sha256": le.sha256(le.OFFICIAL_HARNESS)}, f, indent=2)
    print(f"FINAL_TEST test_acc={acc:.6f} val_acc={val['val_acc']:.6f} seed={seed}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("workdirs", nargs="+", help="finished validation runs (folders with local_eval.json)")
    ap.add_argument("--selection-is-finished", action="store_true",
                    help="required: confirms that no further accept/reject decision will be made")
    ap.add_argument("--one", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args()
    if not args.selection_is_finished:
        sys.exit("refusing to touch the test split: pass --selection-is-finished once selection is over")
    if args.one:
        return run_one(args.workdirs[0])

    rows = []
    for workdir in args.workdirs:  # one process per folder: each imports its own algorithm.py
        with open(os.path.join(workdir, "test_stdout.log"), "wb") as log:
            code = subprocess.call([sys.executable, os.path.abspath(__file__), "--selection-is-finished",
                                    "--one", workdir], stdout=log, stderr=subprocess.STDOUT, cwd=ROOT)
        if code:
            rows.append((workdir, None))
            continue
        with open(os.path.join(workdir, "test_eval.json")) as f:
            rows.append((workdir, json.load(f)))
    print(f"{'run':<34} seed   val      test")
    for workdir, r in rows:
        name = os.path.relpath(workdir, ROOT).replace(os.sep, "/")
        print(f"{name:<34} " + (f"{r['seed']:<5} {100 * r['val_acc']:6.2f}%  {100 * r['test_acc']:6.2f}%" if r
                                else "FAILED (see test_stdout.log)"))


if __name__ == "__main__":
    main()
