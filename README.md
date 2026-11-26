# BOXBAY AI 2.0

Predictive intelligence for high-bay container operations. This independent research demonstrator tests whether demand and pickup signals improve crane scheduling and slot allocation in a simulated, individually accessible storage facility. The modeled process starts and ends at the facility transfer interface. Trays travel in a shallow under-rack channel, and each rack has its own dedicated crane.

- **Command center** at `/` renders authoritative simulation events in a selectable 3D facility. Use the policy switch, scrubber, scenario controls, interventions, topology editor, override preview and snapshots.
- **Shift demo** at `/demo` puts you in the operator's seat: confirm an arrival, approve its slot, then decide whether to reshuffle ahead of pickup. Runs from a bundled recording without an API or operator token.
- **Engineering** at `/engineering` shows the observed data, model holdout, paired operational results, adverse outcomes and illustrative USD sensitivity.
- **Benchmark laboratory** at `/benchmarks` compares four policies on common seeded workloads. Download run-level results and inspect uncertainty.

## Start locally

Use Python 3.11 and Node 22.12 or newer. On macOS install Homebrew `libomp` for XGBoost training.

```sh
make setup
make api             # Terminal 1
make web             # Terminal 2
```

Open [localhost:5173](http://localhost:5173). Startup uses loopback SQLite without cloud credentials. The recorded scenarios, Engineering page and benchmark results are available with the frontend alone. Docker Compose is documented in [Local development](docs/deployment/local-development.md).

## Reproduce and verify

```sh
make train           # Temporal demand and dwell evaluation, versioned JSON export
make benchmark       # 14 scenarios × 8 seeds × 4 policies, plus offline replays
make profile         # Local solver/runtime/RSS measurements
make contracts       # OpenAPI and generated TypeScript
make verify          # Python and frontend checks, tests and production build
```

The demand and dwell models are trained offline. The deployed application loads portable versioned inference data. The simulator owns the rack, crane and container state, and commit events drive the browser. Historical Port of Los Angeles volumes are monthly port-wide TEU. Vessel, container and crane records are simulated. Geometry, carrier behavior and energy coefficients require terminal validation.

## Deployment and evidence

- [Engineering handover](docs/engineering/handover.md)
- [Legacy audit](docs/engineering/legacy-audit.md) and [system architecture](docs/architecture/system.md)
- [Model validation](docs/research/model-validation.md) and [benchmark methodology](docs/business/benchmark-methodology.md)
- [Netlify](docs/deployment/netlify.md), [Railway](docs/deployment/railway.md), [Neon](docs/deployment/neon.md) and [operating cost](docs/deployment/cost-management.md)
- [Executive walkthrough](docs/demo/executive-walkthrough.md) and [scenario catalog](docs/demo/scenario-catalog.md)

The historical React, Node, Python and Unity implementations remain in their original directories. All equipment actions in 2.0 are simulated. The demonstrator has no affiliation with, access to, or operational validation from BOXBAY, DP World or SMS Group.
