"""Record the executive demo branches with the same simulator and facility."""
import json

from services.intelligence.audit import assert_trace
from services.intelligence.domain import (
    Container, Crane, Facility, Intervention, OperatingPolicy, Rack, Restriction, Scenario, TraySystem, Work,
)
from services.intelligence.forecasting import EVIDENCE
from services.intelligence.simulation import Simulator

DEMO_CONTAINER = "BX-2048"
PRIORITY_CONTAINER = "BX-7010"
REVIEW_S = 180


class NoReshuffles(Simulator):
    def relocation_review(self):
        # Keep the same arrival and retrieval policies for the comparison.
        pass


def scenario(priority_job: bool = False) -> Scenario:
    closed = [f"R1:{bay}:{level}:1" for bay in range(1, 7) for level in (1, 2)]
    facility = Facility(
        racks=(Rack(id="R1", bays=8, levels=3, reefer_bays=0),),
        cranes=(Crane(id="CR-01", racks=("R1",), zone="R1", traction_kwh_per_m=0.003),),
        tray=TraySystem(speed_mps=3, load_kwh_per_tonne_m=0.00035),
        operations=OperatingPolicy(energy_weight=120),
        restrictions=tuple(Restriction(slot=slot, blocked=True, reason="Rack inspection") for slot in closed),
    )
    inbound = Work(
        container=Container(id=DEMO_CONTAINER, size_ft=40, gross_kg=27_000, carrier="C01", priority=4,
                            appointment_s=600, carrier_delay_days=0.4),
        release_s=0, pickup_s=600, deadline_s=675,
    )
    priority = Work(
        container=Container(id=PRIORITY_CONTAINER, size_ft=40, gross_kg=21_000, carrier="C02", priority=5,
                            appointment_s=REVIEW_S),
        initial_slot="R1:7:2:1", release_s=0,
        pickup_s=REVIEW_S if priority_job else None, deadline_s=345 if priority_job else None,
    )
    background = tuple(
        Work(container=Container(id=f"BX-40{i:02d}", size_ft=40, gross_kg=18_000, carrier="C02"),
             initial_slot=slot, release_s=0, pickup_s=None)
        for i, slot in enumerate([*(f"R1:{bay}:3:1" for bay in range(1, 7)), "R1:8:2:1"])
    )
    return Scenario(
        id="shift-demo", name="Protect the next pickup", seed=102, horizon_s=800, facility=facility,
        work=(inbound, priority, *background),
        interventions=tuple(Intervention(kind="unblock", target=slot, at_s=150) for slot in closed),
    )


def record() -> dict:
    runs = {
        "keep": NoReshuffles(scenario(), "predictive", "shift-keep").run(),
        "stage": Simulator(scenario(), "predictive", "shift-stage").run(),
        "priority": Simulator(scenario(True), "predictive", "shift-priority").run(),
    }
    for run in runs.values():
        assert_trace(run)
    return {
        "container": DEMO_CONTAINER, "priorityContainer": PRIORITY_CONTAINER, "review_s": REVIEW_S,
        # Timing instrumentation is irrelevant to replay and would make the artifact vary by machine.
        "runs": {key: run.model_dump(mode="json", exclude={"elapsed_ms", "solver_ms"}) |
                 {"elapsed_ms": 0, "solver_ms": []} for key, run in runs.items()},
    }


if __name__ == "__main__":
    (EVIDENCE / "shift-demo.json").write_text(json.dumps(record(), separators=(",", ":")) + "\n")
