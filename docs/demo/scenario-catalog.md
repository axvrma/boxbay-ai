# Scenario catalog

Five curated replays are bundled with the frontend for all four policies. Demand surge has planned vessel releases. Unexpected inbound supplies a short-notice increase. Crane failure shows two outages and recoveries, a waiting pickup and inbound routing to a healthy rack. Operator override applies a feasible alternate placement. Energy comparison exposes matched model accounting. The replay seed is 102 and input snapshots are in `experiments/scenarios`.

The laboratory additionally includes normal, high occupancy, simultaneous vessel notices, late vessel, restricted slots, priority pickups, pickup uncertainty, forecast error and alternate topology. All have paired benchmark evidence. Generate fresh traces with an operator token or `make benchmark`. The static replay set covers the five presentation scenarios.

In Incidents, the vessel workload editor can move planned unreleased work earlier or later, reduce the count, or cancel a wave. It retains old notices and adjusts dependent pickups by the same offsets. The Unexpected inbound fixture demonstrates additional workload.
