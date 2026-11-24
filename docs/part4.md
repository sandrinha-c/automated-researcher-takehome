# Part 4 — main limitation and one controlled improvement

A proposal only. Nothing on this page has been run.

## Main limitation: selection on a single seed

The loop accepts a candidate if its validation accuracy at seed 42 is strictly greater
than the current best. One run at one seed is the only evidence.

| Evidence (20 pretrain epochs, deterministic mode) | Value |
|---|---|
| Unmodified baseline at seeds 42 / 43 / 44 (runs 003, 005, 006) | 17.01% / 9.47% / 9.53% |
| Baseline mean ± sample std over the three seeds | 12.0% ± 4.3 points |
| Gain of accepted run 007 over its parent (seed 42) | +1.39 points |
| Gain of accepted run 009 over its parent (seed 42) | +1.62 points |
| Binomial standard error of one score (3,021 validation images) | about 0.7 points |

Each accepted gain is smaller than the spread of the unchanged baseline across seeds.
Seed 42 is also the best of the three baseline seeds. The loop therefore cannot tell
"this change is better" from "this change suits seed 42", and every further round
selects on the same seed again.

## Hypothesis

Accepting on the mean of several seeds picks changes that hold up on unseen seeds better
than accepting on seed 42 alone, even though it can test fewer ideas for the same GPU
time.

## Comparison

Two arms. Everything is identical except the acceptance rule: same controller, model,
prompt, starting point, evaluator, 20-epoch budget and validation split.

| | Arm A (current) | Arm B (proposed) |
|---|---|---|
| Runs per candidate | 1 (seed 42) | 3 (seeds 42, 43, 44) |
| Accept if | score > best score | mean of 3 > best mean of 3, same seeds for both |
| Feedback to the LLM | one score | three scores and their mean |
| Candidates in 12 training runs (about 5.2 GPU hours) | 12 | 4 |

The baseline's three scores for arm B already exist (runs 003, 005, 006).

**Held-out check.** Afterwards, the baseline, the final best of arm A and the final best
of arm B are each trained on five seeds that neither arm used (45–49), still on the
validation split. That is 15 more runs, about 6.5 GPU hours. The hidden test split is
not used.

## Evaluation criteria

Fixed before running:

1. **Primary:** mean held-out accuracy over seeds 45–49, compared pairwise by seed.
   The hypothesis is supported if arm B's best beats arm A's best on at least 4 of the 5
   seeds and the mean difference is more than twice its standard error. Otherwise it is
   not supported.
2. **Did selection generalise?** For each arm, the gain over the baseline on the
   selection seeds minus the gain on the held-out seeds. Closer to zero is better.
3. **Real gain at all?** For each arm, whether its final best is above the baseline on
   the held-out seeds (mean difference, and on how many of the 5 seeds).
4. **Cost:** GPU hours per arm, kept equal by design, and the number of ideas tested
   (12 against 4). This is the price of arm B and is reported next to the result.

## Known weaknesses of this design

- The LLM is not deterministic, so each arm is a single loop run. A clear result would
  need the two-arm comparison repeated.
- Seeds 43 and 44 start from a much lower baseline (about 9.5%), so arm B's mean may be
  dominated by whether a change rescues those two seeds.
- Three seeds give a rough mean. The rule "strictly greater mean" still accepts small
  differences; a margin could be added once the held-out spread is known.

## Cheapest first step

Re-run the three existing candidates (007, 008, 009) at seeds 43 and 44: six runs, about
2.6 GPU hours, no LLM calls. This shows directly whether the three decisions the loop
already made would have been the same under the three-seed rule.
