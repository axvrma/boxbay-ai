# Browser runtime and evidence

`main.tsx` loads the model and sample inputs on the same origin. `intelligence/inference.ts` traverses trained trees using float32 split semantics and native missing branches. It returns a dwell estimate, conditional interval where calibrated and single-feature sensitivities against fixed training medians. The output shown by the live prediction and the engineering playground uses the same inference code.

`simulation/engine.ts` owns capacity, dispatch constraints, score terms, custody and movement totals. The store keeps up to 32 immutable undo snapshots. Date changes before any operation rebase the initial inventory's ages. Future date changes after a committed move preserve operational history. The presenter can confirm the ranked slot or choose a custom rack, row and column. Rows run upward and columns run along the aisle. Changing priority updates the prediction and slot feasibility. The 2D map can restrict or reopen a cell for both placement policies. The restriction blocks placement and pickup until the cell reopens. Placement validates the selection before the renderer animates the accepted plan. An action ends with one custody record and a settled equipment state.

## Model and feature contract

The synthetic dataset covers January 2022 through December 2026, with July and October 2026 as the split boundaries. Training and calibration exclude examples whose labels end on or cross the next boundary. Receiver history uses earlier completed pickups with fictional priors. Browser inference uses these versioned fictional priors in the absence of facility telemetry. Initial inventory movement classes are calculated from sample cargo and historical operating inputs. Two receivers first appear in the October–December 2026 holdout and use the unseen code and group priors in the browser. The season calendars use local dates and illustrative regional event anchors. Lunar holiday timing and operational effects are scenario assumptions.

The 24-hour and seven-day models use numerical calendar and operating inputs. The benchmark workload and actual pickup schedules are drawn separately from model forecasts. Predictive placement uses expected dwell and demand. The live demo calls the model for the named vendor profile associated with the shipment.

## Operating and cost boundary

Every move uses the same crane and tray equations for all policies. The crane lift uses gravitational potential, efficiency, regeneration, loaded and empty movement, and powered idle. The simulation serializes crane and transfer actions. It skips nonoperating time when the presenter changes calendar dates. Benchmark policies run in equal 20-minute operating windows across 12 dates and accrue idle inside those windows. A date change advances planning context while keeping actual a priori pickup schedules and inventory custody distinct. Benchmark SLA is pickup completion within 60 simulated seconds of the queued request, including time spent behind other cargo.

Time-rate, electricity, movement, CO₂e and FX assumptions are editable hypothetical factors. No real terminal or utility tariff is represented. Completed movement metrics record full execution cost for every placement or pickup. The benchmark displays completed pickup times alongside the number unserved, SLA and adverse cost pairs. Equal infrastructure and inputs do not guarantee equal completed work.

Two rack faces share a rail-mounted stacker. The rail-bound pallet stops at the aisle handoff while the spreader locks on and lifts the container clear. Along-aisle travel and hoisting happen together. The spreader extends sideways at the target height, sets the container onto the shelf and retracts. See 2:28–2:50 and 3:22–3:53 in the supplied BOXBAY video. The model uses demonstration-scale operating speeds and timings. Docking, collision envelopes, industrial interlocks and multi-crane scheduling would require calibrated engineering. The browser cannot control equipment. The calendar supports 2021–2028. The October–December 2026 holdout evaluates forecasts on synthetic records.

## Verified public context

DP World reports 792 trial positions at Terminal 4 and more than 63,000 trial movements by August 2021. Jebel Ali Port handled 15.5 million TEU in 2024. These refer to different scopes.

- [Terminal 4 trial](https://www.dpworld.com/en/news/dp-world-celebrates-boxbay-milestone-with-completion-of-the-first-10000-container-moves)
- [2021 BOXBAY trial results](https://www.dpworld.com/en/news/successful-real-world-trial-of-boxbay-high-bay-storage-system-completed)
- [2024 port throughput](https://www.dpworld.com/en/news/releases/uae/dp-world-records-highest-cargo-volumes-at-jebel-ali-port-since-2015)

## Local verification

The production browser tests exercised both routes, the live prediction-to-placement flow, seasonal inference, undo, validated manual placement and priority changes, mobile layout, artifact errors and WebGL fallback. They applied the Netlify content security policy and blocked external requests and API paths. The hosted domain was outside the local verification.

On an ARM64 MacBook Pro (MacBookPro18,1, 16 GB), headless Chromium 159 with software WebGL produced a 1008 × 520 canvas about 1.44 seconds after navigation in a local preview run. The lazy 3D chunk measured 873 kB minified and 236 kB gzip. These timings describe that test environment.
