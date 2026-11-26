"""Paired comparisons. Bootstrap whole seed pairs, preserving covariance."""
import json
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from random import Random
from statistics import mean, median

from pydantic import Field

from .audit import assert_trace
from .domain import Contract, Facility, Policy
from .forecasting import EVIDENCE, ROOT, model_version
from .scenarios import CATALOG, make_scenario
from .simulation import Run, Simulator

POLICIES: tuple[Policy, ...] = ("fifo", "legacy", "reactive", "predictive")
FIELDS = ("moves", "moves_per_hour", "pickup_wait_s", "p95_wait_s", "on_time_pct", "late",
          "kwh", "kg_co2e", "backlog", "peak_backlog", "ending_inventory")
DEMO = ("surge", "unexpected", "breakdown", "override", "energy")
SEEDS = (102, 137, 208, 311, 412, 519, 625, 733)


class BenchmarkRow(Contract):
    scenario: str
    seed: int
    policy: Policy
    moves: int
    moves_per_hour: float
    pickup_wait_s: float
    p95_wait_s: float
    on_time_pct: float
    late: int
    kwh: float
    kg_co2e: float
    backlog: int
    peak_backlog: int
    ending_inventory: int
    elapsed_ms: float
    solver_calls: int
    solver_limited: int


class Summary(Contract):
    scenario: str
    baseline: Policy
    policy: Policy
    metric: str
    pairs: int
    baseline_mean: float
    policy_mean: float
    delta: float
    median_delta: float
    p95_delta: float
    ci_low: float | None
    ci_high: float | None
    negative_pairs: int
    deltas: list[float]


class Benchmark(Contract):
    schema_version: int = 1
    id: str
    model_version: str
    dataset_version: str = "pola-2010-2025-v1/synthetic-workload-v1"
    rows: list[BenchmarkRow]
    summaries: list[Summary]
    constraint_violations: int = Field(default=0)


def summarize(rows: list[BenchmarkRow]) -> list[Summary]:
    output = []
    scenarios = sorted({r.scenario for r in rows})
    for scenario in scenarios:
        key = {(r.seed, r.policy): r for r in rows if r.scenario == scenario}
        for treatment in ("predictive", "reactive", "legacy", "fifo"):
            for baseline in POLICIES:
                if treatment == baseline:
                    continue
                seeds = sorted({s for s, p in key if p == treatment and (s, baseline) in key})
                if not seeds:
                    continue
                for metric in FIELDS:
                    before = [float(getattr(key[(s, baseline)], metric)) for s in seeds]
                    after = [float(getattr(key[(s, treatment)], metric)) for s in seeds]
                    delta = [b - a for a, b in zip(before, after, strict=True)]
                    rng = Random(386)
                    boot = sorted(mean(rng.choices(delta, k=len(delta))) for _ in range(1000)) if len(seeds) >= 3 else None
                    bigger = metric in ("moves", "moves_per_hour", "on_time_pct")
                    if metric == "ending_inventory":
                        adverse = 0
                    else:
                        adverse = sum(d < 0 if bigger else d > 0 for d in delta)
                    output.append(Summary(
                        scenario=scenario, baseline=baseline, policy=treatment, metric=metric, pairs=len(seeds),
                        baseline_mean=mean(before), policy_mean=mean(after), delta=mean(delta),
                        median_delta=median(delta), p95_delta=sorted(delta)[int(0.95 * (len(delta) - 1) + 0.5)],
                        ci_low=boot[25] if boot else None, ci_high=boot[974] if boot else None,
                        negative_pairs=adverse, deltas=delta,
                    ))
    return output


def row(run: Run) -> BenchmarkRow:
    return BenchmarkRow(
        scenario=run.scenario.id, seed=run.scenario.seed, policy=run.policy,
        **{key: getattr(run.metrics, key) for key in FIELDS},
        elapsed_ms=run.elapsed_ms, solver_calls=sum(run.metrics.solver_status.values()),
        solver_limited=sum(v for k, v in run.metrics.solver_status.items() if k not in ("OPTIMAL", "HEURISTIC")),
    )


def experiment(
    name: str, seeds: tuple[int, ...], policies: tuple[Policy, ...], id_: str,
    topology: Facility | None = None, cancelled: Callable[[], bool] = lambda: False,
) -> Benchmark:
    rows = []
    for seed in seeds:
        scenario = make_scenario(name, seed, topology)
        for policy in policies:
            run = Simulator(scenario, policy, f"{name}-{seed}-{policy}", cancelled).run()
            assert_trace(run)
            rows.append(row(run))
    return Benchmark(id=id_, model_version=model_version(), rows=rows, summaries=summarize(rows))


def run_case(args):
    scenario, seed, policy = args
    run = Simulator(make_scenario(scenario, seed), policy, f"{scenario}-{seed}-{policy}").run()
    assert_trace(run)
    return row(run)


def write(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n")


def main():
    for s in DEMO:
        scenario = make_scenario(s, SEEDS[0])
        write(ROOT / "experiments/scenarios" / f"{s}.json", scenario.model_dump(mode="json"))
        for policy in POLICIES:
            run = Simulator(scenario, policy, f"{s}-{SEEDS[0]}-{policy}").run()
            assert_trace(run)
            write(EVIDENCE / "replays" / f"{s}-{policy}.json", run.model_dump(mode="json"))
    write(EVIDENCE / "catalog.json", {"scenarios": [
        {"id": key, "name": name, "description": description, "recorded": key in DEMO}
        for key, (name, description) in CATALOG.items()
    ], "policies": list(POLICIES), "seed": SEEDS[0]})
    args = [(s, seed, p) for s in CATALOG for seed in SEEDS for p in POLICIES]
    with ProcessPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(run_case, args, chunksize=4))
    result = Benchmark(id="paired-trays-v2", model_version=model_version(), rows=rows, summaries=summarize(rows))
    write(EVIDENCE / "benchmarks.json", result.model_dump(mode="json"))
    print(f"{len(rows)} simulations across {len(CATALOG)} scenarios and {len(SEEDS)} paired seeds")


if __name__ == "__main__":
    main()
