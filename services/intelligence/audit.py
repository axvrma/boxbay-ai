"""Independent checks of committed custody and equipment events."""
from collections import Counter

from .constraints import compatibility, reachable
from .domain import EventKind as K
from .simulation import Run


def assert_trace(run: Run):
    config = run.scenario.facility
    slots = {s.id: s for s in run.slots}
    cranes = {c.id: c for c in config.cranes}
    cargo = {w.container.id: w.container for w in run.scenario.work}
    available = {c.id for c in config.cranes if c.available}
    assert sorted(c.racks[0] for c in cranes.values()) == sorted(r.id for r in config.racks)
    assert all(len(c.racks) == 1 for c in cranes.values())
    reserved = set()
    blocked = {r.slot for r in config.restrictions if r.blocked}
    occ = {w.initial_slot: w.container.id for w in run.scenario.work if w.initial_slot}
    active = {}
    assigned = {}
    resources = Counter()
    retrieved = set()
    moving_tray = None
    tray_cargo = set()
    for expected, event in enumerate(run.events, 1):
        assert expected == event.version
        if event.kind == K.RESERVED:
            assert event.slot not in occ and event.slot not in reserved and event.slot not in blocked
            reserved.add(event.slot)
        elif event.kind == K.OCCUPIED:
            assert event.slot in reserved and event.slot not in blocked
            assert event.slot not in occ and event.container not in occ.values() and event.container not in tray_cargo
            assert compatibility(cargo[event.container], slots[event.slot]) is None
            occ[event.slot] = event.container
            reserved.remove(event.slot)
        elif event.kind == K.RELEASED:
            assert occ.pop(event.slot) == event.container
        elif event.kind == K.FAILED:
            available.remove(event.crane)
        elif event.kind == K.RECOVERED:
            available.add(event.crane)
        elif event.kind == K.BLOCKED:
            blocked.add(event.slot)
        elif event.kind == K.UNBLOCKED:
            blocked.remove(event.slot)
        elif event.kind == K.ASSIGNED:
            assigned[event.task] = event.data["resources"]
            resources.update(assigned[event.task])
            assert all(n <= 1 for n in resources.values())
        elif event.kind == K.TRAY_STARTED:
            assert moving_tray is None
            moving_tray = event.task
            if event.data["loaded"]:
                assert event.container not in occ.values() and event.container not in retrieved
                tray_cargo.add(event.container)
        elif event.kind == K.TRAY_ARRIVED:
            assert moving_tray == event.task
            moving_tray = None
            if event.data["direction"] == "to_interface":
                tray_cargo.discard(event.container)
        elif event.kind == K.HANDOFF:
            if event.data["direction"] == "tray_to_crane":
                tray_cargo.remove(event.container)
            else:
                assert event.container not in occ.values()
                tray_cargo.add(event.container)
        elif event.kind == K.STARTED:
            assert event.crane in available and event.crane not in active
            assert reachable(cranes[event.crane], cargo[event.container], slots[event.slot])
            rack = next(r for r in config.racks if r.id == cranes[event.crane].racks[0])
            for key in ("from_xyz", "source_xyz", "to_xyz"):
                x, _, z = event.data[key]
                assert rack.x <= x <= rack.x + rack.bays * rack.bay_pitch_m
                assert rack.z <= z <= rack.z + (rack.positions - 1) * 4
            active[event.crane] = event.task
        elif event.kind in (K.SUSPENDED, K.COMPLETED):
            assert active.pop(event.crane) == event.task
            if event.kind == K.COMPLETED:
                assert event.crane in available
        elif event.kind == K.HANDLING_CANCELLED and event.data.get("retry"):
            if event.data["reservation_released"]:
                reserved.remove(event.slot)
            resources.subtract(assigned.pop(event.task))
        elif event.kind == K.TASK_COMPLETED:
            resources.subtract(assigned.pop(event.task))
            if event.data["operation"] == "pickup":
                assert event.container not in occ.values() and event.container not in tray_cargo
                assert event.container not in retrieved
                retrieved.add(event.container)
    assert len(occ) == run.metrics.ending_inventory
    assert len(retrieved) == run.metrics.pickups
