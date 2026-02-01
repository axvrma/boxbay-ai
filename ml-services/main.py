from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional
import joblib
import pandas as pd
import numpy as np
import os

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
    column: int

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

    EFFICIENCY_REGEN = 0.65
    JOULES_TO_KWH = 2.77778e-7

    # Use provided slots or fallback to mock (for testing)
    candidate_slots = data.candidate_slots if data.candidate_slots else [
        CandidateSlot(slot_id="Grid:A-Row:1-Column:1", column=1),
        CandidateSlot(slot_id="Grid:A-Row:2-Column:3", column=3),
        CandidateSlot(slot_id="Grid:A-Row:1-Column:5", column=5),
        CandidateSlot(slot_id="Grid:A-Row:3-Column:8", column=8),
        CandidateSlot(slot_id="Grid:A-Row:2-Column:11", column=11)
    ]

    best_slot = None
    min_net_kwh = float('inf')
    best_stats = {}

    mass_kg = data.weight * 1000

    # --- STRATEGY: TIERED ALLOCATION REINFORCED ---
    # Fast Movers (< 3 Days) -> Bottom (Col 1)
    # Average Movers (3 - 7 Days) -> Middle (Col 2)
    # Slow Movers (> 7 Days) -> Top (Col 3)

    target_column = 2 # Default Middle
    dwell = data.dwell_days

    if dwell < 3.0:
        target_column = 1
    elif dwell > 7.0:
        target_column = 3

    print(f"🧠 AI Strategy: Dwell {dwell} days -> Targeting Column {target_column}")

    # Prioritize slots in target column, but fallback if full
    sorted_slots = sorted(candidate_slots, key=lambda s: 0 if s.column == target_column else 1)

    for slot in sorted_slots:
        # Pydantic model access
        column = slot.column
        slot_id = slot.slot_id
        height = (column - 1) * TIER_HEIGHT_METERS

        # Energy In (Lift)
        potential_energy = mass_kg * GRAVITY * height
        kwh_in = (potential_energy / EFFICIENCY_LIFT) * JOULES_TO_KWH

        # Energy Out (Regen)
        kwh_out = (potential_energy * EFFICIENCY_REGEN) * JOULES_TO_KWH

        # Net
        net_kwh = kwh_in - kwh_out

        # Penalize non-target columns slightly to encourage strategy
        if column != target_column:
            net_kwh += 0.05 # Penalty kWh

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