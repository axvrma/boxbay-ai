import pandas as pd
import numpy as np
import os

def generate_logistics_data(n=10000):
    print("🚀 Starting Data Generation...")
    np.random.seed(42)

    # 1. Define typical Receiver Profiles (Fast, Average, Slow)
    receivers = [f'RCVR_{i:03d}' for i in range(1, 101)]
    profiles = np.random.choice(['Fast', 'Average', 'Slow'], size=100, p=[0.2, 0.6, 0.2])
    receiver_map = dict(zip(receivers, profiles))

    # 2. Generate random container data
    data = {
        'container_id': [f'CONT_{i:05d}' for i in range(n)],
        'receiver_id': np.random.choice(receivers, size=n),
        'weight_tons': np.random.uniform(5, 35, size=n),
        'commodity_type': np.random.choice(['Electronics', 'Textiles', 'Perishables', 'Auto'], size=n)
    }

    df = pd.DataFrame(data)

    # 3. Apply Dwell Time Rules based on profile
    def calculate_dwell(row):
        profile = receiver_map[row['receiver_id']]
        # Base days: Fast=1.5, Avg=4, Slow=8
        base_days = {'Fast': 1.5, 'Average': 4.0, 'Slow': 8.0}[profile]

        # Add noise (randomness) and weight influence
        # (Heavier boxes usually stay slightly longer in this synthetic logic)
        noise = np.random.normal(0, 0.5)
        weight_impact = row['weight_tons'] * 0.05

        return max(1, round(base_days + weight_impact + noise, 1))

    df['dwell_time_days'] = df.apply(calculate_dwell, axis=1)

    # 4. Save to 'data' folder at the project root
    # Goes up two levels from 'ml-services/shared' to 'boxbay-digital-twin/data'
    output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../data'))
    os.makedirs(output_dir, exist_ok=True)

    output_path = os.path.join(output_dir, 'synthetic_logs.csv')
    df.to_csv(output_path, index=False)

    print(f"✅ Success: Generated {n} records.")
    print(f"📁 Saved to: {output_path}")

if __name__ == "__main__":
    generate_logistics_data()