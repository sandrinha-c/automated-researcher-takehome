"""Draw docs/search.svg from loop_multiseed/runs.jsonl (standard library only).

One column per candidate of the multi-seed search: a grey dot per seed, a marker for the
mean over the seeds (filled = accepted, hollow = not accepted), and a step line for the
best mean so far. Nothing is typed by hand except the short labels in LABELS.

    python tools/make_search_figure.py
"""
import json
import os
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, "loop_multiseed", "runs.jsonl")
OUT = os.path.join(ROOT, "docs", "search.svg")

LABELS = {  # short names of the change; the full hypothesis is in runs.jsonl
    "009_loop": "old best (lr 0.4)",
    "012_loop": "zero-init residual",
    "013_loop": "loss warmup",
    "014_loop": "lr 0.4 → 0.8",
    "015_loop": "lr 0.4 → 0.2",
    "016_loop": "lr 0.2 → 0.1",
    "017_loop": "lr 0.2 → 0.05",
    "018_loop": "weight decay 5e-4",
    "019_loop": "crop scale 0.08",
}
STATUS = {"baseline": "start", "accepted": "accepted", "rejected": "rejected",
          "screened_out": "screened out", "crash": "crash (seed 44)"}

INK, MUTED, GRID, SEED, ACCENT, SURFACE = "#1f2328", "#59636e", "#d8dee4", "#8c959f", "#0969da", "#ffffff"
W, H, LEFT, RIGHT, TOP, BOTTOM = 960, 470, 56, 24, 64, 96


def main():
    with open(LOG, encoding="utf-8") as f:
        runs = [json.loads(line) for line in f if line.strip()]
    step = (W - LEFT - RIGHT) / len(runs)
    lo, hi = 0.10, 0.55

    def x(i):
        return LEFT + step * (i + 0.5)

    def y(v):
        return TOP + (H - TOP - BOTTOM) * (hi - v) / (hi - lo)

    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
         f'font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12">',
         f'<rect width="{W}" height="{H}" fill="{SURFACE}"/>',
         f'<text x="{LEFT}" y="24" font-size="15" font-weight="600" fill="{INK}">Multi-seed search: '
         f'validation accuracy of every candidate (20 pretrain epochs)</text>',
         f'<text x="{LEFT}" y="44" fill="{MUTED}">grey dot = one seed (42, 43, 44) · blue marker = mean of '
         f'three seeds, filled if accepted · blue line = best mean so far</text>']
    for t in range(10, 56, 10):
        s.append(f'<line x1="{LEFT}" x2="{W - RIGHT}" y1="{y(t / 100):.1f}" y2="{y(t / 100):.1f}" stroke="{GRID}"/>')
        s.append(f'<text x="{LEFT - 8}" y="{y(t / 100) + 4:.1f}" text-anchor="end" fill="{MUTED}">{t}%</text>')

    path = []
    for i, r in enumerate(runs):
        b = r.get("best_after", r.get("val_acc"))
        path.append(f'{"M" if i == 0 else "L"}{x(i) - step / 2:.1f},{y(b):.1f} L{x(i) + step / 2:.1f},{y(b):.1f}')
    s.append(f'<path d="{" ".join(path)}" fill="none" stroke="{ACCENT}" stroke-width="2" opacity="0.45"/>')

    for i, r in enumerate(runs):
        scores = r.get("scores") or {}
        for k, seed in enumerate(sorted(scores)):
            s.append(f'<circle cx="{x(i) + (k - 1) * 9:.1f}" cy="{y(scores[seed]):.1f}" r="4" fill="{SEED}" '
                     f'stroke="{SURFACE}" stroke-width="2"><title>{r["id"]} seed {seed}: '
                     f'{100 * scores[seed]:.2f}%</title></circle>')
        mean = r.get("val_acc")
        if mean is not None:
            kept = r["status"] in ("accepted", "baseline")
            s.append(f'<rect x="{x(i) - 14:.1f}" y="{y(mean) - 2.5:.1f}" width="28" height="5" rx="2.5" '
                     f'fill="{ACCENT if kept else SURFACE}" stroke="{ACCENT}" stroke-width="1.5"/>')
            top = min([y(mean)] + [y(v) for v in scores.values()])
            s.append(f'<text x="{x(i):.1f}" y="{top - 10:.1f}" text-anchor="middle" fill="{INK}" '
                     f'font-weight="{600 if kept else 400}">{100 * mean:.1f}</text>')
        base = H - BOTTOM + 20
        s.append(f'<text x="{x(i):.1f}" y="{base}" text-anchor="middle" fill="{INK}" font-weight="600">'
                 f'{r["id"][:3]}</text>')
        s.append(f'<text x="{x(i):.1f}" y="{base + 17}" text-anchor="middle" fill="{INK}" font-size="11">'
                 f'{escape(LABELS.get(r["id"], ""))}</text>')
        s.append(f'<text x="{x(i):.1f}" y="{base + 34}" text-anchor="middle" fill="{MUTED}" font-size="11">'
                 f'{escape(STATUS.get(r["status"], r["status"]))}</text>')
    s.append("</svg>")
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(s) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
