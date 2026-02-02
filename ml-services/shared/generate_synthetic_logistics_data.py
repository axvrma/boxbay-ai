import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta
import json
import os

# --- CONFIGURATION ---
NUM_SAMPLES = 5000

# Resolve paths relative to this script (ml-services/shared/)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Goal: Write to ml-services/data
DATA_DIR = os.path.join(BASE_DIR, '../data')

OUTPUT_CSV = os.path.join(DATA_DIR, "synthetic_logs.csv")
OUTPUT_META = os.path.join(DATA_DIR, "receivers_metadata.json")

# --- SMART PATTERNS ---
receivers = [
    # FAST MOVERS (1-3 Days)
    {"id": "RCVR_FAST_001", "name": "Speedy Motors", "rating": 5.0, "type": "FAST"},
    {"id": "RCVR_FAST_002", "name": "JustInTime Auto", "rating": 4.8, "type": "FAST"},
    {"id": "RCVR_FAST_003", "name": "Express Logistics", "rating": 4.9, "type": "FAST"},

    # MEDIUM MOVERS (4-7 Days)
    {"id": "RCVR_MED_001", "name": "Standard Auto Parts", "rating": 3.5, "type": "MEDIUM"},
    {"id": "RCVR_MED_002", "name": "Global Components", "rating": 3.8, "type": "MEDIUM"},

    # SLOW MOVERS (10-20 Days)
    {"id": "RCVR_SLOW_001", "name": "LongTerm Storage", "rating": 2.1, "type": "SLOW"},
    {"id": "RCVR_SLOW_002", "name": "Deep Freeze Logistics", "rating": 1.5, "type": "SLOW"},
    {"id": "RCVR_SLOW_003", "name": "Strategic Reserves", "rating": 2.5, "type": "SLOW"},
]

commodities = ["Auto", "Electronics", "Retail", "Chemicals"]

data = []

print("🚀 Generating Smart Dataset...")
print(f"📂 Output Directory: {DATA_DIR}")

for _ in range(NUM_SAMPLES):
    rec = random.choice(receivers)

    # Weight Logic
    weight = round(random.uniform(5.0, 30.0), 1)

    # Dwell Time Logic based on Type
    if rec["type"] == "FAST":
        dwell = round(random.uniform(1.0, 2.9), 1) # < 3 Days
    elif rec["type"] == "SLOW":
        dwell = round(random.uniform(10.0, 20.0), 1) # > 7 Days
    else:
        dwell = round(random.uniform(3.5, 7.0), 1) # 4-7 Days

    in_date = datetime.now() - timedelta(days=random.randint(1, 30))
    out_date = in_date + timedelta(days=dwell)

    data.append({
        "container_id": f"BOX_{random.randint(1000, 9999)}",
        "weight_tons": weight,
        "receiver_id": rec["id"],
        "commodity_type": random.choice(commodities),
        "inbound_date": in_date.strftime("%Y-%m-%d"),
        "actual_outbound_date": out_date.strftime("%Y-%m-%d"),
        "dwell_time_days": dwell
    })

# Save CSV
os.makedirs(DATA_DIR, exist_ok=True)
df = pd.DataFrame(data)
df.to_csv(OUTPUT_CSV, index=False)
print(f"✅ Saved {NUM_SAMPLES} records to {OUTPUT_CSV}")

# Save Metadata for UI
meta_list = [{"id": r["id"], "name": r["name"], "rating": r["rating"]} for r in receivers]
with open(OUTPUT_META, "w") as f:
    json.dump(meta_list, f, indent=2)
print(f"✅ Saved Metadata to {OUTPUT_META}")
