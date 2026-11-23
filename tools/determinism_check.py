"""Is run-to-run variation caused by the data pipeline or by GPU arithmetic?

Reproduces the start of the official pretraining (same seed, same DataLoader settings,
same model, loss and optimizer as task/train_eval_baseline.py) for a few steps and
prints a fingerprint of every input batch plus the exact loss value.

Run it twice in each mode and compare the outputs:
    python tools/determinism_check.py default
    python tools/determinism_check.py deterministic

- Batch fingerprints differ between runs  -> the data/augmentation pipeline is random.
- Fingerprints match but losses differ    -> the GPU computation is nondeterministic.
- Both match in 'deterministic' mode      -> enabling PyTorch determinism removes the noise.
"""
import hashlib
import json
import os
import sys

MODE = sys.argv[1] if len(sys.argv) > 1 else "default"
if MODE == "deterministic":
    os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"  # must be set before CUDA starts

import numpy as np
import torch
from torch.utils.data import DataLoader

HERE = os.path.dirname(os.path.abspath(__file__))
TASK = os.path.join(HERE, "..", "task")
sys.path.insert(0, TASK)
import train_eval_baseline as h  # noqa: E402  (official harness, unchanged)

STEPS = 5


def main():
    if MODE == "deterministic":
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False
        torch.use_deterministic_algorithms(True)

    h.set_seed(42)
    dev = torch.device("cuda")
    raw = h.torchvision.datasets.CIFAR100(root=os.path.join(HERE, "..", "data"), train=True, download=False)
    ds = h.TwoViewSubset(np.array(raw.data), np.array(raw.targets), h.get_augmentation())
    dl = DataLoader(ds, batch_size=512, shuffle=True, num_workers=8, drop_last=True, pin_memory=True)

    model = h.get_model().to(dev)
    cfg = h.get_training_config()
    crit = h.BarlowTwinsLoss(lambda_param=cfg["lambda_param"], embedding_dim=2048).to(dev)
    opt = torch.optim.SGD(model.parameters(), lr=cfg["lr"], momentum=0.9, weight_decay=cfg["weight_decay"])
    model.train()

    out = {"mode": MODE, "batches": [], "losses": []}
    for step, (x1, x2) in enumerate(dl):
        if step == STEPS:
            break
        out["batches"].append(hashlib.sha256(x1.numpy().tobytes() + x2.numpy().tobytes()).hexdigest()[:12])
        _, z1 = model(x1.to(dev))
        _, z2 = model(x2.to(dev))
        loss = crit(z1, z2)
        opt.zero_grad()
        loss.backward()
        opt.step()
        out["losses"].append(repr(loss.item()))
    print(json.dumps(out))


if __name__ == "__main__":
    main()
