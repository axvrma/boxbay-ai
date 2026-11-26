# Executive walkthrough

Start with [Shift demo](http://localhost:5173/demo) for the Senior VP presentation. The point to land is: **we can protect the next pickup with idle crane time, while keeping released work first and giving the operator control.**

1. **Confirm arrival on belt.** BX-2048 arrives with priority 4 and an existing pickup booking. Point out the synthetic carrier history, the model dwell estimate, and the proposed slot. Before you click **Approve placement**, the box stays on the belt.
2. **Approve placement → Review idle window.** The rack inspection clears. Compare leaving the box in place with a 34-second staging move. On the same simulated workload, staging cuts pickup wait from 103 to 63 seconds, meets the 75-second cutoff, and uses 3.41 kWh versus 3.84 kWh for the whole run, including staging and powered idle.
3. **Approve reshuffle → Run booked pickup.** The box reaches transfer 12 seconds before cutoff. Choose **Try another plan**, turn on **Inject priority pickup**, and show why reshuffling is deferred. **Serve priority pickup** shows that the same crane handles the urgent release first. The quiet-run comparison no longer applies because the work changed. The original pickup can still miss its cutoff; the scheduler does not hide that trade-off.

Close by proposing a small shadow-mode pilot: compare recommendations against current practice on actual pickup windows and crane meter data while operators retain control. Ask to measure late pickups, energy per completed move and acceptance of recommendations. The demo uses one curated workload and illustrative equipment settings; its numbers are not a terminal savings forecast.

The approval and branch selector control playback of real simulator traces. They do not pause or dispatch a live engine. To reproduce the fixture from the repository root, run `.venv/bin/python -m scripts.generate_shift_demo`. The quiet runs use the same inputs and predictive placement; the comparison run disables idle relocation only. The priority branch releases a second pickup at the review time. No machine or equipment connection is required.

## When asked for more detail

Open the command center in **Demand surge**. The view opens on a paused slot recommendation. Amber marks the tray route and mint marks the selected rack crane and position. **Under-rack tray view** lowers the camera toward the transfer channel.

1. **Demand surge.** **Place ahead of the surge** opens BX-0045 at 00:03:00 with 41 expected inbound requests. Predictive AI selects R2:3:1:1 and estimates 65 seconds, including 36 for the tray and 29 for the crane. The reactive policy chose R2:1:2:1 for the same request. Step through **At decision → Tray departs → Crane starts → At outcome**. The dedicated crane stays in Rack 2 while the loaded tray approaches below storage.
   Select **Keep a closer slot open** to compare two slots evaluated together. The AI chose R1:2:3:1 for BX-0073. Its move was estimated at 60 seconds versus 56 for R1:1:5:1. The main scoring advantage was keeping space near the interface open for incoming work. Click either slot to inspect the facility at the decision, and open **How the AI scored these slots** to see how the estimates contributed. **More decision evidence** shows when the separate reactive run handled the same request.
2. **Unexpected inbound.** Select **Unexpected vessel notice** to see the forecast update, then **Place after the surprise** to inspect a placement made after that update.
3. **Crane failure.** **Pickup waits for its rack crane** shows BX-0031 staying in R1:3:1:1 while CR-01 is offline. **Tray returns with inbound load → Place inbound in a working rack** shows BX-0042 returning from Rack 1 and then being routed to Rack 2. CR-02 handles the new placement from its own rack. **Rack crane returns → Resume pickup in the same rack** shows CR-01 handling the original pickup after recovery.
4. **Operator override.** **Compare the operator’s slot** shows how choosing R3:8:5:1 instead of R1:1:1:1 changes the tray route and switches the assignment from CR-01 to CR-03. The estimate adds 93 seconds and 3.06 kWh.
5. **Energy comparison.** Inspect the tray and crane split on a placement. Use **End of run → Operations, interventions and run metrics** to compare energy with completed moves and backlog. The seed-102 predictive run used 68.74 kWh and completed 81 moves. Reactive used 70.47 kWh and completed 82.

Close on **Benchmarks** with **Demand surge**, **Reactive optimizer** and **Predictive AI**. Across eight seed pairs, the predictive policy added 42.79 seconds to mean pickup wait. The throughput and on-time pickup intervals included zero. Show **Forecast error** if asked about risk. The shared route is a modeled constraint, and timings and geometry are illustrative.

The five recorded scenarios work with the backend unavailable. The event log and forward/back controls separate same-second events. Live runs, topology changes and interventions require the engine and configured access.
