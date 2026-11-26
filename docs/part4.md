# Part 4 — main limitation and one controlled improvement

The proposal below takes one observation of the pilot run (README, "Pilot run beyond the
brief") and changes one factor. The control group already exists; the experimental
search was started on 2026-11-26 and is recorded in `docs/explore_experiment.md`.

## Main limitation: the loop explores only when progress stalls

The pilot run had a rule for changing direction: after two candidates in a row that ran
but did not become the new best, a proposal of the same kind as the last failure is
refused. In the run this condition never occurred.

| Evidence from the pilot run (`loop_multiseed/runs.jsonl`) | Value |
|---|---|
| Times the explore rule fired | 0 of 8 candidates |
| Candidates by kind | optimisation 6, architecture 1, augmentation 1, loss 0 |
| Accepted candidates by kind | optimisation 4, all others 0 |
| Candidates accepted | 4 of 8 |

The LLM found that changes to the step size worked (warmup of the loss scale, then three
steps down in learning rate, then weight decay) and stayed with them. That direction
also produced the whole gain, from 20.37% to 48.00%. So the limitation is not that the
run did badly. It is that the run cannot say whether the same budget, partly spent on
other kinds of change, would have found a better candidate: the question was never put.

## Hypothesis

With exploration at a fixed ratio, the search reaches a better best for the same
training budget than with exploration that starts only on stagnation.

The literature expects the opposite in this situation. The FML-bench paper [1] reports
that "greedy search tends to be more effective when opportunities are dense, while
tree-search and evolutionary strategies tend to be more effective when opportunities are
sparse", and that final performance is associated with early convergence and
directionally focused exploration, not with solution diversity. In the pilot run half of
the candidates were accepted, which is the dense case.

## Comparison

Two groups. Only the explore rule differs.

| | Control | Experimental |
|---|---|---|
| Status | done: the pilot run, candidates 012–019 | started 2026-11-26 |
| Explore rule | on stagnation: after two candidates in a row without improvement, another kind is required | at a fixed ratio: every second candidate that is trained must be of the kind trained least so far; the program names the kind and the LLM writes the change |
| Closest published design | AdaptiveSearch in [1]: greedy first, explore on detecting stagnation | the fixed exploration ratio of OpenEvolve [5] (`exploration_ratio: 0.2` by default), applied to a sequential loop |
| Command | `python controller.py --seeds 42,43,44 --max-runs 23` | the same, with `--explore-every 2` |

The same in both: the starting point (009, with its scores on seeds 42, 43 and 44), the
screening on seed 42 (a candidate more than 1 point behind is dropped), acceptance on
the mean of three seeds, the limit of 23 training runs, the model and effort, the
evaluator and the 20-epoch budget, and the prompt template apart from the explore
instruction.

The ratio is one in two, not OpenEvolve's 0.2, because 23 training runs give only about
ten candidates; at 0.2 only about two of them would be assigned.

Because the budget is the same in both groups, a difference cannot come from running
longer. That was the open question of the pilot run against round 1.

## Evaluation criterion

Fixed before the experimental search was started:

1. **Main measure.** The final best `algorithm.py` of each group is trained from scratch
   on five seeds that neither group used (45–49), on the validation split. The measure
   is the paired difference in accuracy per seed, reported as the mean and for each seed.
2. **Reading it.** If the experimental group wins on at least four of the five seeds,
   that is a first signal worth repeating. Bouthillier et al. [7] recommend a probability
   of outperforming of 0.75 as the threshold for a meaningful difference; four of five
   is 0.8 as a point estimate.
3. **Also reported.** How many kinds of change each group tried, and how many produced
   an accepted candidate (control: 3 tried, 1 with an accept).
4. **Cost.** 23 training runs for the experimental search (about 9.5 GPU hours) and
   10 runs for the five seeds of both final bests (about 4.3 GPU hours).

## What this can and cannot show

- The five seeds compare two final `algorithm.py` files. They measure whether one file
  is better than the other on seeds it was not selected on.
- Each search strategy is run once, and the LLM is not deterministic. A win for either
  group may come from one lucky proposal. Saying which strategy is better in general
  needs several independent full searches per strategy.
- Five seeds give little statistical power; [7] arrives at about 29 runs for its
  recommended threshold. An unclear result means adding seeds.
- "Only the explore rule differs" is true of the rules. The assigned candidates also
  change which categories the LLM sees as tried in later prompts; that is an effect of
  the rule, not a second difference.
- The experimental group may lose. The control's 48% came from four accepted steps in a
  row in one direction; the experimental group spends half its candidates elsewhere.
  That result would agree with [1] and is reported in the same way.

## Earlier version of this proposal

Until 2026-11-26 this file proposed a different comparison: accepting on one seed
against accepting on the mean of three, at equal budget. Its motivation still stands
(the two gains round 1 accepted, +1.39 and +1.62 points, are smaller than the 1.8 points
between identical runs of the baseline and the 7.5 points between seeds). It was
replaced because the three-seed rule was already implemented and used in the pilot run,
so it was no longer a proposal, and because the pilot run pointed to a question that was
still open. That comparison was not run. A replay of the pilot run's eight decisions
with seed 42 only gives the same accept or reject for six of them (README), so the pilot
run does not show that the three-seed rule helped.

## References

[1] Q. Zou et al. FML-bench: A controlled study of AI research agent strategies from
the perspective of search dynamics. arXiv:2605.17373v2, 2026.
[5] A. Sharma. OpenEvolve: An open-source evolutionary coding agent. GitHub, 2025.
[7] X. Bouthillier et al. Accounting for Variance in Machine Learning Benchmarks.
Proceedings of Machine Learning and Systems (MLSys) 3, 2021.
