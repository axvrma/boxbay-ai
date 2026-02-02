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
**Goal:** Auto-dispatch crane when Truck is *about* to arrive ($Wait\_Time = 0$).

### The Workflow (Implemented)
1.  **User Inputs:**
    *   **Select Container:** Filtered dropdown of occupied slots.
    *   **Target Time:** Desired unload time (e.g., 10 mins).
    *   **Truck Distance:** Logic-driven slider (0-20 km).
2.  **Physics Trigger (Logic):**
    *   **Speed Constant:** Truck moves at 40 km/h (1.5 mins/km).
    *   **Calculated ETA:** $ETA = Distance \times 1.5$.
3.  **State Machine:**
    *   **En Route:** $ETA > Target$.
    *   **Dispatched:** $ETA \le Target$. (Crane triggers `POST /api/outbound/retrieve`).
    *   **Delivered:** $Distance = 0 km$. (Final "Success" state).

---

## UI/UX Design System
To ensure a premium, control-tower aesthetic, the dashboard adheres to strict design rules:
1.  **Typography**: `Google Sans`, `Inter`, `Segoe UI`. Clean, modern, and legible.
2.  **Layout**: **2x2 Grid System**.
    *   **Top:** Twin Grids (A & B) visualization.
    *   **Bottom:** Three functional cards (Smart Inbound, Housekeeping, JIT + Logs) sharing equal widths (45%) and height profiles.
3.  **Color Coding (The "Heat Map" Grid):**
    *   **🟦 Blue:** **Fast Movers** (< 3 Days). High priority.
    *   **🟥 Red:** **Slow Movers** (> 7 Days). Long-term storage.
    *   **🟧 Orange:** **Medium Movers**. Standard priority.
    *   **Gradients:** Removed in favor of solid, high-contrast colors for clarity.