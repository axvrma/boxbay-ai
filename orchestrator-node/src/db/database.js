const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../../data/boxbay.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Initialize schema FIRST before any prepared statements
function initializeDatabase() {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    console.log('✅ Database schema initialized');
    
    // Seed slots if empty
    const slotCount = db.prepare('SELECT COUNT(*) as count FROM slots').get();
    if (slotCount.count === 0) {
        seedSlots();
    }
}

function seedSlots() {
    const grids = ['A', 'B'];
    const columns = 5;
    const rows = 3;
    
    const insert = db.prepare(`
        INSERT INTO slots (id, grid, row, column, container_id)
        VALUES (?, ?, ?, ?, NULL)
    `);
    
    const insertMany = db.transaction((slots) => {
        for (const slot of slots) {
            insert.run(slot.id, slot.grid, slot.row, slot.column);
        }
    });
    
    const slots = [];
    grids.forEach(grid => {
        for (let c = 1; c <= columns; c++) {
            for (let r = 1; r <= rows; r++) {
                slots.push({
                    id: `Grid:${grid}-Col:${c}-Row:${r}`,
                    grid,
                    row: r,
                    column: c
                });
            }
        }
    });
    
    insertMany(slots);
    console.log(`✅ Seeded ${slots.length} slots`);
}

// Initialize on load - MUST happen before prepared statements
initializeDatabase();

// Container operations - prepared AFTER schema init
const containerOps = {
    create: db.prepare(`
        INSERT INTO containers (id, weight, receiver_id, commodity, predicted_dwell_days, slot_id, inbound_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `),
    
    updateOutbound: db.prepare(`
        UPDATE containers SET outbound_at = datetime('now'), actual_dwell_days = ?
        WHERE id = ?
    `),
    
    getById: db.prepare('SELECT * FROM containers WHERE id = ?'),
    
    getActive: db.prepare('SELECT * FROM containers WHERE outbound_at IS NULL'),
    
    getRecent: db.prepare(`
        SELECT * FROM containers 
        ORDER BY inbound_at DESC 
        LIMIT ?
    `)
};

// Slot operations
const slotOps = {
    getAll: db.prepare('SELECT * FROM slots ORDER BY grid, column, row'),
    
    getAvailable: db.prepare('SELECT * FROM slots WHERE container_id IS NULL'),
    
    occupy: db.prepare('UPDATE slots SET container_id = ? WHERE id = ?'),
    
    release: db.prepare('UPDATE slots SET container_id = NULL WHERE id = ?'),
    
    getByContainerId: db.prepare('SELECT * FROM slots WHERE container_id = ?')
};

// Energy events
const energyOps = {
    log: db.prepare(`
        INSERT INTO energy_events (container_id, slot_id, operation, lift_kwh, regen_kwh, net_kwh, random_kwh)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    
    getTodayTotal: db.prepare(`
        SELECT 
            COALESCE(SUM(net_kwh), 0) as total_net,
            COALESCE(SUM(random_kwh), 0) as total_random,
            COUNT(*) as move_count
        FROM energy_events 
        WHERE date(timestamp) = date('now')
    `),
    
    getHourly: db.prepare(`
        SELECT 
            strftime('%H', timestamp) as hour,
            SUM(net_kwh) as smart_kwh,
            SUM(random_kwh) as random_kwh
        FROM energy_events 
        WHERE date(timestamp) = date('now')
        GROUP BY strftime('%H', timestamp)
        ORDER BY hour
    `),
    
    getRecent: db.prepare(`
        SELECT * FROM energy_events 
        ORDER BY timestamp DESC 
        LIMIT ?
    `)
};

// Metrics operations
const metricsOps = {
    log: db.prepare(`
        INSERT INTO metrics_log (total_energy_kwh, random_energy_kwh, moves_count, throughput_teu, utilization_pct, violations_count, crane_idle_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    
    getLatest: db.prepare(`
        SELECT * FROM metrics_log 
        ORDER BY timestamp DESC 
        LIMIT 1
    `),
    
    getToday: db.prepare(`
        SELECT * FROM metrics_log 
        WHERE date(timestamp) = date('now')
        ORDER BY timestamp DESC
    `)
};

// Truck queue operations
const truckOps = {
    add: db.prepare(`
        INSERT INTO truck_queue (truck_id, container_id, distance_km, eta_minutes, status)
        VALUES (?, ?, ?, ?, 'en_route')
    `),
    
    update: db.prepare(`
        UPDATE truck_queue 
        SET distance_km = ?, eta_minutes = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
    `),
    
    getActive: db.prepare(`
        SELECT * FROM truck_queue 
        WHERE status != 'delivered'
        ORDER BY eta_minutes ASC
    `),
    
    markDelivered: db.prepare(`
        UPDATE truck_queue 
        SET status = 'delivered', updated_at = datetime('now')
        WHERE container_id = ?
    `)
};

module.exports = {
    db,
    containerOps,
    slotOps,
    energyOps,
    metricsOps,
    truckOps
};
