import pandas as pd
import numpy as np
import os

def generate_logistics_data(n=10000):
    print("🚀 Starting Data Generation with STRICT Rules...")
    np.random.seed(42)
    import json

    # 1. Define Receiver Metadata (ID, Name, Rating, Profile)
    # Profile: 'Fast' (High Rating) -> Short Dwell
    # Profile: 'Average' (Mid Rating) -> Medium Dwell
    # Profile: 'Slow' (Low Rating) -> Long Dwell

    company_suffixes = ["Logistics", "Imports", "Trading", "Global", "Solutions", "Freight", "Group"]
    company_prefixes = ["Alpha", "Beta", "Gamma", "Delta", "Apex", "Prime", "Swift", "Rapid", "Globe", "Metro"]

    receivers_metadata = []
    receiver_map = {} # ID -> Profile

    for i in range(1, 101):
        rid = f'RCVR_{i:03d}'
        name = f"{np.random.choice(company_prefixes)} {np.random.choice(company_suffixes)}"

        # Decide Profile first, then assign Rating based on it
        profile = np.random.choice(['Fast', 'Average', 'Slow'], p=[0.3, 0.5, 0.2])

        if profile == 'Fast':
            rating = round(np.random.uniform(4.0, 5.0), 1) # High Rating
        elif profile == 'Average':
            rating = round(np.random.uniform(3.0, 3.9), 1) # Mid Rating
        else:
            rating = round(np.random.uniform(1.0, 2.9), 1) # Low Rating

        receivers_metadata.append({
            "id": rid,
            "name": name,
            "rating": rating,
            "profile": profile
        })
        receiver_map[rid] = profile

    # 2. Save Metadata for API Usage
    meta_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../data/receivers_metadata.json'))
    os.makedirs(os.path.dirname(meta_path), exist_ok=True)
    with open(meta_path, 'w') as f:
        json.dump(receivers_metadata, f, indent=2)
    print(f"📋 Saved Receiver Metadata to: {meta_path}")

    # 3. Generate random container data
    receivers_list = [r['id'] for r in receivers_metadata]

    data = {
        'container_id': [f'CONT_{i:05d}' for i in range(n)],
        'receiver_id': np.random.choice(receivers_list, size=n),
        'weight_tons': np.random.uniform(5, 35, size=n),
        'commodity_type': np.random.choice(['Electronics', 'Textiles', 'Perishables', 'Auto'], size=n)
    }

    df = pd.DataFrame(data)

    # 4. Apply Dwell Time Rules based on profile REINFORCED
    def calculate_dwell(row):
        profile = receiver_map[row['receiver_id']]
        # Base days: Fast=1.5, Avg=4, Slow=8
        base_days = {'Fast': 1.5, 'Average': 4.0, 'Slow': 8.0}[profile]

        # Add noise (randomness) and weight influence
        noise = np.random.normal(0, 0.5)
        weight_impact = row['weight_tons'] * 0.05

        # Ensure 'Fast' is strictly faster than 'Slow' usually
        val = base_days + weight_impact + noise
        return max(0.5, round(val, 1))

    df['dwell_time_days'] = df.apply(calculate_dwell, axis=1)

    # 5. Save to 'data' folder at the project root
    output_dir = os.path.dirname(meta_path)
    output_path = os.path.join(output_dir, 'synthetic_logs.csv')
    df.to_csv(output_path, index=False)

    print(f"✅ Success: Generated {n} records.")
    print(f"📁 Saved to: {output_path}")

if __name__ == "__main__":
    generate_logistics_data()