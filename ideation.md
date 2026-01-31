# BoxBay Digital Twin: POC Workflow Design (HBS Logic)

## Overview
This document outlines the logic for the BoxBay High Bay Storage system. Since every container is directly accessible (no reshuffling), the AI focuses purely on **Energy Arbitrage** and **Time Optimization**.

---

## Scenario 1: Energy-Centric Inbound (Direct Access Logic)
**Goal:** Select the rack slot that offers the best **Net Energy ROI**, treating the rack like a battery.

### The Workflow
1.  **Trigger:** Container arrives at **Transfer Tray**.
2.  **Data Ingestion:** Node.js gets `{ContainerID, Weight, ReceiverID}`.
3.  **The "Energy Contest" (Brain B):**
    * Node.js queries the **Grid State** to find *all* empty slots.
    * **The Simplified AI Loop:**
        * Since there is no reshuffling, the AI doesn't care about "blocking" other boxes.
        * It filters slots based on **Constraint:** `Max_Crane_Travel_Time` (Don't pick a slot so far away that it bottlenecks throughput).
        * **The Calculation:** For every valid slot, it calculates:
            $$Net\_kWh = E_{lift\_consumption} - (E_{lower\_recovery} \times \eta_{regen})$$
            *(Where $E_{lower\_recovery}$ is calculated based on the future retrieval)*
    * **Strategy:**
        * **Heavy Box:** Prefer lower tiers (Minimize Lift Cost) OR very high tiers (Maximize Regen) *if* the math proves the Regen efficiency > Lift Inefficiency.
        * **Light Box:** Fill the "energy-expensive" slots (Middle/High) since they cost less to lift.
4.  **Execution:**
    * AI returns the best slot.
    * Unity executes the move.
    * **Dashboard:** Shows "Net Energy Optimized: No Reshuffling Risk."

---

## Scenario 2: GPS-Triggered Pre-Fetch (Just-in-Time)
**Goal:** Retrieve the container from its rack so it reaches the dock *exactly* when the truck arrives.

### The Workflow
1.  **Tracking:** Background service tracks Truck GPS.
2.  **Time Calculation (Simplified):**
    * Since access is direct, `Retrieval_Time` is deterministic physics:
        $$Time = \max \left( \frac{Height}{V_{hoist}}, \frac{Distance}{V_{trolley}} \right) + T_{buffer}$$
3.  **The Trigger:**
    * `IF (Truck_ETA <= Retrieval_Time)` -> **Dispatch Crane**.
4.  **Result:**
    * Crane picks the box from the rack.
    * Lowers it to the delivery point.
    * **Zero Wait Time:** Truck stops, crane locks, box drops.