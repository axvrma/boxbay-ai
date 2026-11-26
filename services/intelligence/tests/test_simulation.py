from random import Random

import pytest
from pydantic import ValidationError

from services.intelligence.benchmarks import experiment
from services.intelligence.audit import assert_trace
from services.intelligence.domain import (
    Container, Crane, EventKind as K, Facility, Intervention, Rack, Restriction, Scenario, VesselRevision, Work,
)
from services.intelligence.energy import movement
from services.intelligence.scenarios import facility, make_scenario, revise_vessel
from services.intelligence.simulation import Simulator


@pytest.mark.parametrize("policy", ["fifo", "legacy", "reactive", "predictive"])
def test_deterministic_and_feasible(policy):
    case = make_scenario("breakdown", 102)
    a = Simulator(case, policy, "paired").run()
    b = Simulator(case, policy, "paired").run()
    assert a.model_dump(exclude={"elapsed_ms", "solver_ms"}) == b.model_dump(exclude={"elapsed_ms", "solver_ms"})
    assert_trace(a)
    assert a.metrics.moves > 0
    assert any(e.kind == K.PICKUP_WAITING for e in a.events)


def test_crane_load_and_compatibility():
    rack = Rack(id="small", bays=1, levels=1, reefer_bays=0, sizes=(20,), max_kg=19_000)
    config = Facility(racks=(rack,), cranes=(Crane(id="C", zone="A", racks=("small",), max_kg=18_000),))
    boxes = (
        Container(id="big", size_ft=40, gross_kg=14_000, carrier="X"),
        Container(id="heavy", size_ft=20, gross_kg=18_500, carrier="X"),
        Container(id="cold", size_ft=20, gross_kg=14_000, cargo="reefer", carrier="X"),
        Container(id="sensible", size_ft=20, gross_kg=14_000, carrier="X"),
    )
    case = Scenario(id="case", name="case", seed=0, facility=config, horizon_s=300,
                    work=tuple(Work(container=c, release_s=0, pickup_s=None) for c in boxes))
    run = Simulator(case, "predictive", "case").run()
    assert [e.container for e in run.events if e.kind == K.OCCUPIED] == ["sensible"]
    assert run.metrics.backlog == 3
    assert_trace(run)


def test_override_safe_and_audited():
    case = make_scenario("override", 102)
    run = Simulator(case, "predictive", "test").run()
    assert any(d.override and d.override["feasible"] for d in run.decisions)
    source = case.interventions[0]
    modified = case.model_copy(update={"interventions": (
        Intervention(kind="block", at_s=0, target=source.slot), source,
    )})
    rejection = Simulator(modified, "predictive", "test").run()
    assert any(e.kind == K.REJECTED and e.container == source.target for e in rejection.events)
    assert_trace(rejection)


def test_hold_and_hard_cutoff():
    config = facility(1, 1)
    cid = Container(id="hold", size_ft=20, gross_kg=14_000, carrier="X", hold_until_s=100)
    work = Work(container=cid, release_s=0, pickup_s=10, initial_slot="R1:1:1:1", deadline_s=50, hard=True)
    scenario = Scenario(id="hold", name="holding", seed=3, facility=config, work=(work,), horizon_s=300)
    run = Simulator(scenario, "predictive", "hold").run()
    assert run.metrics.pickups == 0
    assert run.metrics.late == 1 and run.metrics.ending_inventory == 1


def test_rack_removal_rejected_for_saved_inventory():
    original = make_scenario("topology", 109)
    payload = original.model_dump()
    payload["facility"] = facility(1, 1).model_dump()
    with pytest.raises(ValidationError, match="unknown initial slot"):
        Scenario.model_validate(payload)


def test_energy_and_units():
    crane = Crane(id="C", zone="A", racks=("R",), traction_kwh_per_m=0, aux_kw=0, tare_kg=0)
    lift = movement(crane, (0, 0, 0), (0, 0, 0), (0, 10, 0), 25_000)
    assert lift.kwh == pytest.approx(25_000 * 9.80665 * 10 / (3_600_000 * crane.lift_efficiency))
    assert lift.vertical_m == 10
    case = make_scenario("normal", 103)
    run = Simulator(case, "reactive", "test").run()
    assert run.metrics.kg_co2e == pytest.approx(run.metrics.kwh * case.facility.grid_kg_per_kwh)
    assert run.metrics.kwh == pytest.approx(run.metrics.motion_kwh + run.metrics.idle_kwh)


def test_restricted_capacity_and_safety_across_seeded_workloads():
    for seed in Random(228).sample(range(1000), 4):
        config = facility(2, 2).model_copy(update={"restrictions": (
            Restriction(slot="R1:1:1:1", reserve_for="X"),
        )})
        run = Simulator(make_scenario("restricted", seed, config), "predictive", "test").run()
        assert_trace(run)
        assert all(e.slot != "R1:1:1:1" for e in run.events if e.kind == K.OCCUPIED)


def test_paired_experiment_keeps_negative_results():
    report = experiment("forecast-error", (102, 137, 208), ("reactive", "predictive"), "smoke")
    assert len(report.rows) == 6
    service = next(s for s in report.summaries if s.metric == "pickup_wait_s" and s.policy == "predictive")
    assert service.pairs == 3 and service.ci_low <= service.delta <= service.ci_high
    assert len(service.deltas) == 3


def test_vessel_revision_preserves_released_cargo_and_pickup_offsets():
    original = make_scenario("surge", 102)
    changed = revise_vessel(original, VesselRevision(vessel="VSL-01", notice_s=1110,
                                                    estimated_arrival_s=1800, inbound_count=3))
    original_work = {w.container.id: w for w in original.work}
    affected = [w for w in changed.work if w.container.vessel == "VSL-01" and w.release_s >= 1110]
    assert len(affected) == 3 and min(w.release_s for w in affected) == 1800
    for w in affected:
        previous = original_work[w.container.id]
        if w.pickup_s is not None:
            assert w.pickup_s - w.release_s == previous.pickup_s - previous.release_s
    assert all(w in changed.work for w in original.work if w.release_s < 1110)
    run = Simulator(changed, "predictive", "vessel").run()
    assert any(e.kind == K.VESSEL and e.t == 1110 and e.data["inbound_count"] == 3 for e in run.events)


def test_topology_prohibits_cross_rack_cranes():
    config = facility(2)
    body = config.model_dump()
    body["cranes"][0]["racks"] = ["R1", "R2"]
    with pytest.raises(ValidationError, match="one dedicated crane"):
        Facility.model_validate(body)
    body["cranes"][0]["racks"] = ["R2"]
    with pytest.raises(ValidationError, match="one dedicated crane"):
        Facility.model_validate(body)


def test_pickup_completes_at_interface_after_dedicated_crane_handoff():
    config = facility(2)
    cargo = Container(id="pickup", size_ft=20, gross_kg=14_000, carrier="X")
    case = Scenario(id="outage", name="Outage", seed=3, facility=config, horizon_s=800,
                    work=(Work(container=cargo, release_s=0, pickup_s=10, initial_slot="R1:2:1:1"),),
                    interventions=(Intervention(kind="failure", target="CR-01", at_s=1),
                                   Intervention(kind="recovery", target="CR-01", at_s=120)))
    run = Simulator(case, "predictive", "test").run()
    assert_trace(run)
    wait = next(e for e in run.events if e.kind == K.PICKUP_WAITING)
    tray_out = next(e for e in run.events if e.kind == K.TRAY_STARTED and e.data["loaded"])
    handoff = next(e for e in run.events if e.kind == K.HANDOFF)
    completed = next(e for e in run.events if e.kind == K.TASK_COMPLETED)
    assert wait.t == 10 and handoff.t >= 120
    assert tray_out.crane == handoff.crane == "CR-01"
    assert handoff.data["direction"] == "crane_to_tray" and handoff.version < tray_out.version
    assert completed.t == tray_out.data["finish_s"] and run.metrics.pickup_wait_s == completed.t - 10
    assert run.metrics.tray_kwh > 0


def test_mid_lift_failure_keeps_inbound_on_its_tray_through_return():
    config = facility(1)
    cargo = Container(id="inbound", size_ft=40, gross_kg=14_000, carrier="X")
    case = Scenario(id="outage", name="Outage", seed=3, facility=config, horizon_s=800,
                    work=(Work(container=cargo, release_s=0, pickup_s=None),),
                    interventions=(Intervention(kind="failure", target="CR-01", at_s=12),
                                   Intervention(kind="recovery", target="CR-01", at_s=120)))
    run = Simulator(case, "fifo", "test").run()
    assert_trace(run)
    suspended = next(e for e in run.events if e.kind == K.SUSPENDED)
    returned = next(e for e in run.events if e.kind == K.TRAY_ARRIVED and
                    e.data["loaded"] and e.data["direction"] == "to_interface")
    stored = [e for e in run.events if e.kind == K.OCCUPIED]
    assert suspended.t < returned.t < stored[0].t and len(stored) == 1
