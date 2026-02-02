# BoxBay Digital Twin: Smart Architecture (HBS Logic)

## Overview
BoxBay resolves the "Re-Shuffling Problem" of traditional stacking by providing direct access to every container. This allows the system to optimize for **Energy Efficiency** and **Predictive Placement** rather than just accessibility.

---

## Scenario 1: Predictive Smart Inbound
**Goal:** Optimize slot allocation based on **Predicted Dwell Time** (how long it stays) and **Energy efficiency** ($E=mgh$).

### The Workflow (End-to-End)

1.  **User Input (Dashboard):**
    *   **Variables:** Container Weight, Receiver ID.
    *   **Optional:** Inbound/Outbound Date.
    *   **Action:** Click "Optimize".

2.  **Orchestrator Logic (Node.js):**
    *   `POST /api/inbound/optimize`
    *   **Step A: Check Date**
        *   If the user *provides* a date, calculate `Dwell Days` directly.
        *   If the user *omits* the date, call **Brain A (Predictor)**.
    *   **Step B: Brain A (Prediction Model)**
        *   **Input:** Receiver ID, Weight, Commodity.
        *   **Model:** XGBoost Regressor (trained on synthetic logistics data).
        *   **Logic:**
            *   "Speedy Motors" -> Fast Mover (~2 days).
            *   "LongTerm Storage" -> Slow Mover (~15 days).
        *   **Output:** Predicted `Dwell Days`.
    *   **Step C: Brain B (Allocation Engine)**
        *   **Input:** `Dwell Days`, Weight, Candidate Slots.
        *   **Logic:** Physics + Strategy.

3.  **The "Energy Contest" (Brain B Logic):**
    *   **Physics Calculation:**
        $$Net\_kWh = E_{lift} - (E_{regen} \times \eta_{eff})$$
        *   Lifting higher costs more energy ($mgh$).
    *   **Strategic Tiering (The BoxBay Advantage):**
        *   **Fast Movers (< 3 Days):** MUST go to **Row 1 (Bottom)**. Least energy to access frequent items.
        *   **Slow Movers (> 7 Days):** MUST go to **Row 3 (Top)**. Store-and-forget logic. Higher energy cost upfront is acceptable for long storage.
        *   **Average Movers:** **Row 2 (Middle)**.
    *   **Penalty Enforcement:**
        *   A Strategy Penalty ($2.0 \text{ kWh}$) is applied if a slot is in the "Wrong Row" for the container's dwell profile.
        *   This overrides the pure physics cost, forcing strict adherence to the tiering strategy.

4.  **Execution:**
    *   **Grid State:** Slot is marked `occupied`.
    *   **Dashboard:**
        *   Tooltips display: Receiver, Weight, Predicted Out Date.
        *   Graph shows Energy Savings vs. Random placement.

---

## Scenario 2: Smart Housekeeping (Reshuffling)
**"The Grid That Cleans Itself"**
- **Problem**: Over time, the grid gets disorganized (entropy). Fast movers get buried under slow movers due to rushed inbound operations.
- **AI Solution (Brain C)**:
    - Scans the grid for violations (e.g., Fast Mover in Row 3).
    - **Complex Swap Logic (The BoxBay Dance)**:
        - If the target row is full, the AI executes a **3-Step Swap** using the **Transfer Tray** as a buffer.
        - `Step 1`: Move Blocker (Slow Mover) -> Buffer Tray.
        - `Step 2`: Move Target (Fast Mover) -> Blocker's Slot (Row 1).
        - `Step 3`: Move Blocker (from Buffer) -> Target's Old Slot (Row 3).
    - **UI Feature**: A "Beautiful Timeline" card that breaks down these complex moves into readable, highlighted steps (e.g., "🔄 Swap BOX_A ↔ BOX_B").

### Scenario 3: Just-in-Time Retrieval (GPS Trigger)
**Goal:** Retrieve the container so it hits the transfer tray exactly when the truck arrives ($Wait\_Time = 0$).

### The Workflow
1.  **Tracking:** Background service/slider simulates Truck GPS distance (km).
2.  **Physics Trigger:**
    *   The system knows the exact physical properties of the crane (Hoist Speed, Trolley Speed).
    *   It calculates: $T_{retrieval} = \max(T_{hoist}, T_{trolley})$.
3.  **Action:**
    *   When $T_{truck\_arrival} \le T_{retrieval} + T_{buffer}$, dispatch the crane.
    *   The crane retrieves the box *while* the truck is parking.