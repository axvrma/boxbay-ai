from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import joblib
import pandas as pd
import numpy as np
import os
import math
from datetime import datetime

app = FastAPI()

# --- GLOBAL VARIABLES FOR ARTIFACTS ---
# We define them here so they stay in memory
model_dwell = None
le_receiver = None
le_commodity = None

# Paths to the artifacts we generated with trainer.py
MODEL_DIR = "dwell-time-model/model"
MODEL_PATH = os.path.join(MODEL_DIR, "dwell_time_v1.joblib")
ENC_REC_PATH = os.path.join(MODEL_DIR, "receiver_encoder.joblib")
ENC_COM_PATH = os.path.join(MODEL_DIR, "commodity_encoder.joblib")

@app.on_event("startup")
def load_artifacts():
    global model_dwell, le_receiver, le_commodity
    try:
        if os.path.exists(MODEL_PATH):
            model_dwell = joblib.load(MODEL_PATH)
            le_receiver = joblib.load(ENC_REC_PATH)
            le_commodity = joblib.load(ENC_COM_PATH)
            print("✅ Brain A (Dwell Time Model) Loaded Successfully")
        else:
            print(f"⚠️ Warning: Model artifacts not found at {MODEL_DIR}. Run trainer.py first!")
    except Exception as e:
        print(f"❌ Error loading artifacts: {e}")

# --- INPUT SCHEMAS ---
class CandidateSlot(BaseModel):
    slot_id: str
    column: int # Horizontal (X)
    row: int    # Vertical (Y / Height)

class InboundData(BaseModel):
    weight: float       # in Tons
    receiverId: str
    commodity: str = "Auto" # Default if not provided
    dwell_days: Optional[float] = 3.5 # Default Dwell Time
    candidate_slots: Optional[List[CandidateSlot]] = None

# --- BRAIN A: DWELL TIME PREDICTOR ---
@app.post("/predict-date")
async def predict_date(data: InboundData):
    """
    Predicts how many days the container will stay.
    Uses XGBoost + Entity Embeddings (Label Encoders).
    """
    if model_dwell is None:
        # Fallback if model isn't trained yet
        return {"predictedDate": 3.5, "status": "fallback"}

    try:
        # 1. Handle "Cold Start" (New Receiver ID we haven't seen)
        try:
            rec_encoded = le_receiver.transform([data.receiverId])[0]
        except ValueError:
            # If unknown, use the most common one or a default '0'
            rec_encoded = 0

        try:
            com_encoded = le_commodity.transform([data.commodity])[0]
        except ValueError:
            com_encoded = 0

        # 2. Create DataFrame for Prediction
        # Must match the columns used in trainer.py
        input_df = pd.DataFrame([[data.weight, rec_encoded, com_encoded]],
                                columns=['weight_tons', 'receiver_encoded', 'commodity_encoded'])

        # 3. Predict
        prediction = model_dwell.predict(input_df)[0]

        # Model is now retrained with STRICT logic, so raw prediction is correct.

        return {
            "predictedDate": round(float(prediction), 1),
            "status": "success"
        }

    except Exception as e:
        print(f"Prediction Error: {e}")
        return {"predictedDate": 4.0, "status": "error", "details": str(e)}

# --- BRAIN B: SLOT ALLOCATOR (PHYSICS ENGINE) ---
@app.post("/allocate-slot")
async def allocate_slot(data: InboundData):
    """
    Runs the 'Energy Contest' using Physics (E=mgh).
    Calculates Net kWh (Lift - Regen).
    """
    # Physics Constants
    GRAVITY = 9.81
    TIER_HEIGHT_METERS = 3.0
    EFFICIENCY_LIFT = 0.85
    EFFICIENCY_REGEN = 0.65
    JOULES_TO_KWH = 2.77778e-7

    # Use provided slots or fallback
    candidate_slots = data.candidate_slots if data.candidate_slots else []

    best_slot = None
    min_net_kwh = float('inf')
    best_stats = {}

    mass_kg = data.weight * 1000

    # --- STRATEGY: TIERED ALLOCATION ---
    # Fast Movers -> Bottom (Row 1)
    # Slow Movers -> Top (Row 3)

    target_row = 2 # Default Middle
    dwell = data.dwell_days

    if dwell < 3.0:
        target_row = 1
    elif dwell > 7.0:
        target_row = 3

    print(f"🧠 AI: Dwell {dwell} days -> Target Row {target_row}")

    # Prioritize slots in target row
    sorted_slots = sorted(candidate_slots, key=lambda s: 0 if s.row == target_row else 1)

    for slot in sorted_slots:
        row = slot.row
        column = slot.column
        slot_id = slot.slot_id

        # HEIGHT depends on ROW (1-based)
        height = (row - 1) * TIER_HEIGHT_METERS

        # Energy In (Lift)
        potential_energy = mass_kg * GRAVITY * height
        kwh_in = (potential_energy / EFFICIENCY_LIFT) * JOULES_TO_KWH

        # Energy Out (Regen)
        kwh_out = (potential_energy * EFFICIENCY_REGEN) * JOULES_TO_KWH

        # Net
        net_kwh = kwh_in - kwh_out

        # Strategy Penalty
        # Physics Cost to Row 3 is ~0.22 kWh. Penalty must be > 0.22 to force strategy.
        if row != target_row:
            net_kwh += 2.0 # Major Penalty to enforce strategy over raw energy

        if net_kwh < min_net_kwh:
            min_net_kwh = net_kwh
            best_slot = slot_id
            best_stats = {
                "lift": round(kwh_in, 4),
                "regen": round(kwh_out, 4),
                "net": round(net_kwh, 4)
            }

    return {
        "targetSlot": best_slot,
        "predictedNetKwh": best_stats['net'],
        "savings": "$0.45", # Mock currency value
        "details": best_stats
    }

# --- BRAIN C: HOUSEKEEPING (OPTIMIZATION) ---
class GridSlot(BaseModel):
    id: str
    grid: str
    row: int
    column: int
    status: str # occupied, available
    containerId: Optional[str] = None
    expectedOutboundDate: Optional[str] = None
    receiverId: Optional[str] = None

class GridState(BaseModel):
    slots: List[GridSlot]

@app.post("/housekeeping")
async def optimize_grid(data: GridState):
    """
    Scans the grid for misplaced containers and returns a plan to fix them.
    Misplaced = Fast Mover in Row 3, Slow Mover in Row 1.
    """
    moves = []

    # 1. Parse dates and classify containers
    now = datetime.now()

    occupied = [s for s in data.slots if s.status == 'occupied']
    empty = [s for s in data.slots if s.status == 'available']

    misplaced = []

    for slot in occupied:
        if not slot.expectedOutboundDate:
            continue

        try:
            # Handle potential ISO format or simple date
            d_str = slot.expectedOutboundDate.split('T')[0]
            out_date = datetime.strptime(d_str, "%Y-%m-%d")
            dwell_remaining = (out_date - now).days
        except:
            continue

        # Determine Optimal Row
        optimal_row = 2
        profile = "MEDIUM"

        if dwell_remaining < 3:
            optimal_row = 1
            profile = "FAST"
        elif dwell_remaining > 7:
            optimal_row = 3
            profile = "SLOW"

        # Check Violation
        if slot.row != optimal_row:
            severity = abs(slot.row - optimal_row)
            if severity >= 2: # Only fix max error (1 vs 3)
                misplaced.append({
                    "slot": slot,
                    "target_row": optimal_row,
                    "profile": profile
                })

    # 2. Generate Moves
    if not misplaced:
        return {"moves": ["✅ Grid is optimized. No reshuffling needed."]}

    print(f"🧹 Housekeeping: Found {len(misplaced)} severe violations.")

    # Simple Greedy Swap Strategy
    # If no empty slot, can we swap? For POC, just list moves to buffer or empty.

    for item in misplaced:
        origin = item['slot']
        target_row = item['target_row']
        profile = item['profile']

        # 1. Try Simple Move (Empty Slot in Target Row)
        candidate = None
        for cand in empty:
            if cand.row == target_row:
                candidate = cand
                break

        if candidate:
            moves.append(f"🔹 <b>Simple Move:</b> Shift <b>{origin.containerId}</b> ({profile}) to empty slot in Row {target_row}.")
            empty.remove(candidate)
            continue

        # 2. Complex Swap via Transfer Tray (Target Row is FULL)
        # Find a container in Target Row that is 'Blocking' us.
        # Ideally, find a "Reverse Misplaced" item (e.g. Slow in Row 1 if we are Fast).

        swap_partner = None
        current_occupied_in_target = [s for s in occupied if s.row == target_row]

        # Priority: Find a PERFECT SWAP partner (e.g. Slow in Row 1)
        for p in current_occupied_in_target:
            p_profile = "UNKNOWN"
            # Estimate partner profile (simplified logic)
            if p.expectedOutboundDate:
                try:
                    d_str = p.expectedOutboundDate.split('T')[0]
                    od = datetime.strptime(d_str, "%Y-%m-%d")
                    dr = (od - now).days
                    if dr < 3: p_profile = "FAST"
                    elif dr > 7: p_profile = "SLOW"
                    else: p_profile = "MEDIUM"
                except: pass

            if profile == "FAST" and target_row == 1 and p_profile == "SLOW":
                swap_partner = p
                break # Found perfect swap!
            if profile == "SLOW" and target_row == 3 and p_profile == "FAST":
                swap_partner = p
                break # Found perfect swap!

        # Fallback: Just pick FIRST available blocker if no perfect swap found
        if not swap_partner and current_occupied_in_target:
            swap_partner = current_occupied_in_target[0]

        if swap_partner:
            print(f"🔄 Using Transfer Tray to swap {origin.containerId} (needs Row {target_row}) with {swap_partner.containerId}")

            moves.append(f"🔄 SWAP SEQUENCE (via Transfer Tray):")
            moves.append(f"  1. MOVE BLOCKER {swap_partner.containerId} (Row {target_row}) -> BUFFER_TRAY")
            moves.append(f"  2. MOVE TARGET {origin.containerId} ({profile}) -> {swap_partner.id}")
            moves.append(f"  3. MOVE BLOCKER {swap_partner.containerId} (from Buffer) -> {origin.id}")

            # remove partner from available blockers for this iteration (heuristic)
            if swap_partner in current_occupied_in_target:
                 # In a real loop we'd update 'data.slots', here we just avoid re-using same partner blindly
                 pass
        else:
             moves.append(f"⚠️ Gridlock: Cannot move {origin.containerId}. No partners found.")

    if not moves:
        moves.append("No feasible moves found.")

    return {"moves": moves}

# --- METADATA ENDPOINTS ---
@app.get("/receivers")
async def get_receivers():
    """
    Returns a list of Receivers with Mock Metadata (Name, Rating)
    derived from the ID list in synthetic_logs.csv.
    """
    try:
        # Load from the Metadata JSON generated by generate_data.py
        meta_path = os.path.join(os.path.dirname(__file__), "data/receivers_metadata.json")

        if os.path.exists(meta_path):
            import json
            with open(meta_path, 'r') as f:
                return json.load(f)

        return []

    except Exception as e:
        print(f"Error reading receivers: {e}")
        return []


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)