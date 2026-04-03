-- BoxBay Digital Twin Database Schema

-- Containers table - tracks all containers that have been processed
CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  receiver_id TEXT NOT NULL,
  commodity TEXT DEFAULT 'Auto',
  predicted_dwell_days REAL,
  actual_dwell_days REAL,
  slot_id TEXT,
  inbound_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  outbound_at DATETIME,
  energy_used REAL DEFAULT 0
);

-- Slots table - represents the physical grid structure
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  grid TEXT NOT NULL,
  row INTEGER NOT NULL,
  column INTEGER NOT NULL,
  container_id TEXT,
  FOREIGN KEY (container_id) REFERENCES containers(id)
);

-- Metrics log - stores periodic snapshots of system performance
CREATE TABLE IF NOT EXISTS metrics_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  total_energy_kwh REAL DEFAULT 0,
  random_energy_kwh REAL DEFAULT 0,
  moves_count INTEGER DEFAULT 0,
  throughput_teu INTEGER DEFAULT 0,
  utilization_pct REAL DEFAULT 0,
  violations_count INTEGER DEFAULT 0,
  crane_idle_pct REAL DEFAULT 0
);

-- Energy events - tracks individual energy consumption events
CREATE TABLE IF NOT EXISTS energy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  container_id TEXT,
  slot_id TEXT,
  operation TEXT CHECK(operation IN ('inbound', 'outbound', 'housekeeping')),
  lift_kwh REAL DEFAULT 0,
  regen_kwh REAL DEFAULT 0,
  net_kwh REAL DEFAULT 0,
  random_kwh REAL DEFAULT 0
);

-- Truck queue - simulates incoming trucks for JIT retrieval
CREATE TABLE IF NOT EXISTS truck_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  truck_id TEXT NOT NULL,
  container_id TEXT,
  distance_km REAL DEFAULT 20,
  eta_minutes REAL,
  status TEXT CHECK(status IN ('en_route', 'dispatched', 'delivered')) DEFAULT 'en_route',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_containers_slot ON containers(slot_id);
CREATE INDEX IF NOT EXISTS idx_containers_receiver ON containers(receiver_id);
CREATE INDEX IF NOT EXISTS idx_energy_events_timestamp ON energy_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_log_timestamp ON metrics_log(timestamp);
