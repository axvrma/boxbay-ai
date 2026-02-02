import pandas as pd
import xgboost as xgb
import joblib
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
from sklearn.preprocessing import LabelEncoder
import os

def train_dwell_time_model():
    print("🧠 Starting Brain A Training...")

    # 1. Load the synthetic data
    # Looks for data in 'boxbay-digital-twin/ml-services/data'
    base_dir = os.path.dirname(__file__)
    data_path = os.path.abspath(os.path.join(base_dir, '../data/synthetic_logs.csv'))

    if not os.path.exists(data_path):
        print(f"❌ Error: File not found at {data_path}")
        print("   -> Run 'python ../shared/generate_synthetic_logistics_data.py' first.")
        return

    df = pd.read_csv(data_path)
    print(f"📊 Loaded {len(df)} records.")

    # 2. Preprocessing: Encode Categorical Data (ReceiverID -> Number)
    le_receiver = LabelEncoder()
    le_commodity = LabelEncoder()

    df['receiver_encoded'] = le_receiver.fit_transform(df['receiver_id'])
    df['commodity_encoded'] = le_commodity.fit_transform(df['commodity_type'])

    # 3. Define Features (X) and Target (y)
    X = df[['weight_tons', 'receiver_encoded', 'commodity_encoded']]
    y = df['dwell_time_days']

    # 4. Split data
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # 5. Train XGBoost
    print("⏳ Training XGBoost Model...")
    model = xgb.XGBRegressor(
        n_estimators=100,
        learning_rate=0.1,
        max_depth=5,
        objective='reg:squarederror'
    )
    model.fit(X_train, y_train)

    # 6. Validate
    predictions = model.predict(X_test)
    error = mean_absolute_error(y_test, predictions)
    print(f"🎯 Accuracy Check: Average error is {round(error, 2)} days.")

    # 7. Save Artifacts to 'model/' folder
    model_dir = os.path.join(base_dir, 'model')
    os.makedirs(model_dir, exist_ok=True)

    joblib.dump(model, os.path.join(model_dir, 'dwell_time_v1.joblib'))
    joblib.dump(le_receiver, os.path.join(model_dir, 'receiver_encoder.joblib'))
    joblib.dump(le_commodity, os.path.join(model_dir, 'commodity_encoder.joblib'))

    print(f"✅ Artifacts saved to: {model_dir}")

if __name__ == "__main__":
    train_dwell_time_model()