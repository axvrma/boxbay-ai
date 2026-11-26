"""Measure fixed-seed simulation and local API service costs in the current environment."""
import json
import platform
import resource
from statistics import median
from sys import platform as os_name
from time import perf_counter

from fastapi.testclient import TestClient

from services.intelligence.api import app
from services.intelligence.benchmarks import write
from services.intelligence.forecasting import ROOT
from services.intelligence.scenarios import facility, make_scenario
from services.intelligence.simulation import Simulator


def main():
    cases = []
    with TestClient(app) as client:
        times = []
        for _ in range(20):
            start = perf_counter()
            assert client.get("/api/v1/health").is_success
            times.append((perf_counter() - start) * 1000)
    for racks, cranes in ((2, 2), (3, 3), (5, 5), (8, 8)):
        traces = [Simulator(make_scenario("high-occupancy", seed, facility(racks, cranes)), "predictive", "profile").run()
                  for seed in (102, 137, 208)]
        solver = sorted(m for run in traces for m in run.solver_ms)
        cases.append({
            "racks": racks, "cranes": cranes, "slots": len(traces[0].slots),
            "requests_including_initial": len(traces[0].scenario.work),
            "median_run_ms": median(t.elapsed_ms for t in traces),
            "p95_solver_ms": solver[int(.95 * (len(solver) - 1))] if solver else None,
            "median_moves": median(t.metrics.moves for t in traces),
            "peak_process_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (
                1024 * 1024 if os_name == "darwin" else 1024
            ),
        })
    report = {
        "platform": platform.platform(), "python": platform.python_version(),
        "health_transport": "in-process ASGI test client", "median_health_ms": median(times),
        "p95_health_ms": sorted(times)[18], "cases": cases,
    }
    write(ROOT / "experiments/reports/local-performance.json", report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
