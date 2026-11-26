# Paired benchmarks

The catalog includes 14 scenarios. Each predefined case has eight seeds and four policies, for 448 runs. Each seed uses a common starting inventory, facility, carrier and vessel workload, resource disruption and evaluation horizon. The main comparison is predictive versus CP-SAT reactive. FIFO and legacy tiering are reference points.

The evidence stores per-seed outcomes and paired mean, median, P95, empirical 95% bootstrap interval and adverse-pair count. Resampling uses entire seed pairs, 1,000 draws and a fixed seed. Small synthetic cohorts and multiple comparisons limit interpretation. Confidence intervals describe only the fixture and candidate policies. The report makes separate counts for evaluated nonoptimal solver statuses. A CP-SAT feasible result is useful even when the time budget prevents proving an optimum.

Wait is request to pickup completion. Energy includes powered idle, aborted movements and unfinished execution time. Interpret outcomes alongside completed moves, end inventory and backlog. A lower energy total can result from doing less work.
