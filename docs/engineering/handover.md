# BOXBAY AI 2.0 engineering handover

## Executive assessment

The working prototype combines a deterministic high-bay simulator, bounded predictive planning, visual playback and a reproducible benchmark lab. The current demonstrator assigns one crane to each rack and uses timed tray legs below the rack. The updated benchmarks expose shared-route contention and longer pickup waits in some scenarios. The earlier results used a different topology.

## Implementation and architecture

- React, TypeScript, Vite, Three.js, Recharts, TanStack Query and Zustand provide the command center, case study and laboratory. The browser consumes immutable events for playback and submits scenario mutations to Python.
- A single FastAPI service runs SimPy state transitions and OR-Tools CP-SAT decisions. It persists versioned topology, scenario snapshots and experiment evidence in local SQLite or PostgreSQL. Recorded JSON remains usable with the API offline.
- Facility topology, reachability, slot compatibility, transfer capacity, outages, operator overrides, SLA and energy accounting are shared by every policy. Work starts and ends at the high-bay interface. Individual slot access avoids conventional bottom-of-stack assumptions.
- The Node, CRA, original ML and Unity prototypes remain in their original paths. The [legacy audit](legacy-audit.md) records verified state, coordinate, lifecycle and energy defects. See [architecture](../architecture/system.md) and [API contract](../architecture/api-contracts.md).

## Data and model evidence

Port of Los Angeles supplied 192 monthly loaded and empty TEU observations from January 2010 through December 2025. EPA eGRID supplies the CAMX 2023 electricity factor. Kaggle candidates were screened using published metadata and excluded pending provenance, access and geotemporal checks. Source URLs and terms are in the [source manifest](../../data/manifests/sources-v1.json).

Demand candidates were seasonal naive, a three-year seasonal mean and XGBoost. XGBoost was selected on 2022–2023 and evaluated over 24 rolling monthly origins in 2024–2025. Loaded import MAE was **36,024 TEU**, compared with **55,139 TEU** for seasonal naive. Loaded export MAE was **8,042 TEU**, compared with **14,231 TEU** for seasonal naive. WAPE was 8.10% and 6.60%. Empirical nominal-90% interval coverage was 95.83% and 100%, indicating conservative intervals on this holdout.

The dwell generator created 6,600 records and couples carrier/booking behavior, cargo properties and release uncertainty. On 1,376 temporal holdout records, XGBoost achieved **0.784 days MAE** and **90.04%** interval coverage. The appointment-plus-median baseline was better at **0.753 days MAE**. The unseen-carrier cohort reached **0.737 days MAE** on 310 records. The trained predictor is experimental and supplies a dwell estimate for records without a booked pickup. See [model evidence](../../apps/web/public/evidence/models.json) and [generator assumptions](../research/synthetic-data.md).

## Benchmark results and business impact

The canonical experiment ran four policies across 14 scenarios and eight matched seeds. It includes FIFO, legacy tiering, reactive CP-SAT and predictive CP-SAT. Candidate selection, shared resource constraints, deadline penalties and queue aging are documented in [optimization](optimization.md). Trace invariants were checked for all 448 experiment runs. The [benchmark artifact](../../apps/web/public/evidence/benchmarks.json) contains paired intervals, adverse seed counts, solver status and per-run evidence.

With dedicated cranes and a shared tray layout, predictive CP-SAT increased mean pickup wait by **42.79 seconds** in Demand surge versus reactive CP-SAT (95% paired interval +13.50 to +73.16). It averaged **1.00 fewer completed moves** and **1.00 more unfinished tasks**. The on-time pickup delta was **−1.60 percentage points**, with a confidence interval spanning zero. Electricity changed by **−0.58 kWh**, with an interval spanning zero and a different completion count.

Forecast error added **107.00 seconds** mean wait and **8.25 tasks** to ending backlog. The breakdown scenario added **72.20 seconds** mean wait. Lower electrical totals can reflect incomplete work. The finance control is an illustrative sensitivity based on the matched scenario and user-entered cost assumptions.

Energy contains loaded and empty lift, bounded regeneration, horizontal traction, auxiliaries, powered idle and loaded and empty tray travel. Interrupted movement accrues partial energy. Grid conversion is location-based eGRID CAMX, approximately 0.19504 kg CO₂e/kWh. [Energy accounting](energy-emissions.md)

## Verification and performance

Local Ruff, targeted mypy, ESLint, TypeScript, generated contracts and the production build passed. The local suites cover both the intelligence service and browser replay. Automated tests cover deterministic traces, availability and interference locks, valid custody and reservations, weight/size/reefer, holds and cutoff, overrides, unit conversion, benchmark intervals, data reproducibility, API authorization and payload limits. Local PostgreSQL 16 applied the migration and round-tripped a record. The earlier release was also exercised in a Linux ARM64 container against PostgreSQL. The local Docker build used a verified wheel cache after a PyPI download timed out.

The [engine profile](../../experiments/reports/local-performance.json) covers 80–320 storage slots. On an Apple M1 Pro, median run times were 0.74–1.14 s, P95 solver time 7.54–9.22 ms, and cumulative process peak RSS 145–157 MiB. Median in-process health latency was 1.04 ms. The [earlier browser profile](../../experiments/reports/browser-performance.json) predates tray playback. The new replay was checked in desktop and mobile Chrome. The facility uses instancing and includes a keyboard-accessible slot map. The browser test exercised live simulation, topology changes, vessel revisions, snapshot save/restore, benchmark submission, desktop/mobile rendering and recorded replay with API requests blocked.

## Start and deploy

Run `make setup`, `make api`, and `make web` with Python 3.11 and Node 22.12+. Build output is `apps/web/dist`. The Python runtime loads approved model JSON and never trains at startup. Reproduce using `make train`, `make benchmark`, `make profile`, and `make verify`.

Use [Netlify](../deployment/netlify.md) for the Vite build with `VITE_API_BASE_URL`. Attach [Railway](../deployment/railway.md) to the root Dockerfile. Set `PORT` through the platform and configure `BOXBAY_OPERATOR_TOKEN`, `BOXBAY_ADMIN_TOKEN`, `BOXBAY_CORS_ORIGINS` and the [Neon](../deployment/neon.md) `DATABASE_URL`. Optional `BOXBAY_STATE_DIR` configures local SQLite. Provision the custom domain and TLS as described in the runbooks. Budget for one vCPU and 512 MiB initially, with a USD 10–30 active-month planning estimate and account limits where supported.

Cloud accounts and DNS were unavailable. Hosted Netlify, Railway, Neon and GitHub Actions runs remain unverified. Local verification is the deployment evidence. Published assets are small enough to use static hosting. R2 is optional.

## Pilot scope and known limits

The topology, crane assignments, hazard classes, recovery and energy parameters are engineering assumptions for this demo. The attached video shows the pallet circulation system around 02:30–02:50. The model uses one dedicated crane per rack module and one shared tray route. There is no proprietary system integration. The model locks each rack and reserves the single shared transfer route per tray leg. Failure uses an abstract local custody rollback. The optimizer considers a bounded set and commits only immediate starts. Congestion and resource reservations are simplified. A saved scenario restarts from its recorded input state. Running jobs are tied to one process. The static bundle covers five scenarios, while all 14 have benchmark summaries. The browser topology editor starts a new seeded run and rejects removing occupied locations or an executing crane from the displayed state. The vessel editor revises or cancels planned workload. The unexpected-inbound fixture demonstrates additional arrivals. Observed data support monthly forecasts. Higher-frequency samples are synthetic and their intervals are illustrative.

A controlled terminal-data pilot should collect timestamped boundary requests, appointment revisions, crane travel and energy telemetry, availability and validated rack/interference constraints. Recalibrate profiles and compare in read-only shadow operation with an operational control policy. Pre-register service, backlog, energy and safety acceptance criteria and evaluate deteriorations by demand and outage regime.
