import axios from 'axios';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import io from 'socket.io-client';

const SOCKET_SERVER = "http://localhost:3000";
const socket = io(SOCKET_SERVER);

function App () {
  // State for Scenario 1 (Inbound)
  const [containerId, setContainerId] = useState("BOX_001");
  const [weight, setWeight] = useState(25.0);
  const [aiPrediction, setAiPrediction] = useState(null);

  // State for Scenario 2 (GPS)
  const [distance, setDistance] = useState(10.0); // km
  const [truckStatus, setTruckStatus] = useState("En Route");

  // Logs
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    // Debugging: Log connection attempts
    socket.on('connect_error', (err) => {
      console.error("❌ Socket Connection Error:", err.message);
      addLog(`❌ Connection Failed: ${err.message}`);
    });

    socket.on('connect', () => {
      console.log("✅ Socket Connected!", socket.id);
      addLog("✅ Connected to System Core");
      socket.emit('register', 'dashboard'); // <--- The most important line
    });

    // ... (Keep your prediction_alert and prefetch_alert listeners here) ...

    // Force register if already connected on load
    if (socket.connected) {
      socket.emit('register', 'dashboard');
    }

    return () => socket.off(); // Cleanup
  }, []);

  const addLog = (msg) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  // --- HANDLERS ---

  const handleInbound = async () => {
    // FAILSAFE 1: Force re-registration right before asking
    console.log("Re-registering as dashboard...");
    socket.emit('register', 'dashboard');

    addLog(`📦 Sending Inbound Request for ${containerId}...`);

    try {
      await axios.post(`${SOCKET_SERVER}/api/inbound/optimize`, {
        containerId,
        weight: parseFloat(weight),
        receiverId: "RCVR_005"
      });
    } catch (err) {
      console.error(err);
      addLog(`❌ Error: ${err.message}`);
    }
  };

  const handleSliderChange = async (e) => {
    const val = parseFloat(e.target.value);
    setDistance(val);

    // Send GPS Update
    await axios.post(`${SOCKET_SERVER}/api/tracking/update`, {
      truckId: "TRUCK_99",
      containerId: "BOX_55",
      distanceKm: val,
      speedKmH: 60
    });
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial', backgroundColor: '#f4f4f9', minHeight: '100vh' }}>

      {/* STATUS BAR */}
      <div style={{ padding: '10px', marginBottom: '20px', background: socket.connected ? '#d4edda' : '#f8d7da', color: socket.connected ? '#155724' : '#721c24', borderRadius: '5px' }}>
        <strong>System Status: </strong>
        {socket.connected ? "🟢 ONLINE (Connected to Brain)" : "🔴 OFFLINE (Socket Disconnected)"}
      </div>

      <h1>🏭 BoxBay Digital Twin Control Tower</h1>

      <div style={{ display: 'flex', gap: '20px' }}>

        {/* PANEL 1: INBOUND CONTROLS */}
        <div style={cardStyle}>
          <h2>Scenario 1: Smart Inbound</h2>
          <div style={{ marginBottom: '10px' }}>
            <label>Container ID: </label>
            <input value={containerId} onChange={e => setContainerId(e.target.value)} />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>Weight (Tons): </label>
            <input type="number" value={weight} onChange={e => setWeight(e.target.value)} />
          </div>
          <button onClick={handleInbound} style={btnStyle}>Optimize & Store</button>

          {aiPrediction && (
            <div style={{ marginTop: '20px', padding: '10px', background: '#e0ffe0', borderRadius: '5px' }}>
              <h3>Energy Analysis</h3>
              <BarChart width={300} height={200} data={[
                { name: 'Lift Cost', kwh: aiPrediction.details?.lift || 0 },
                { name: 'Regen Recovery', kwh: aiPrediction.details?.regen || 0 },
                { name: 'Net Usage', kwh: aiPrediction.predictedNetKwh || 0 }
              ]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="kwh" fill="#8884d8" />
              </BarChart>
              <p><strong>Est. Savings:</strong> {aiPrediction.savings}</p>
            </div>
          )}
        </div>

        {/* PANEL 2: GPS CONTROLS */}
        <div style={cardStyle}>
          <h2>Scenario 2: Just-in-Time Retrieval</h2>
          <p>Truck Distance: <strong>{distance} km</strong></p>
          <input
            type="range"
            min="0" max="10" step="0.5"
            value={distance}
            onChange={handleSliderChange}
            style={{ width: '100%' }}
          />
          <div style={{ marginTop: '20px', padding: '10px', background: truckStatus === "CRANE DISPATCHED" ? '#ffcccc' : '#ddd' }}>
            Status: <strong>{truckStatus}</strong>
          </div>
        </div>

        {/* PANEL 3: LIVE LOGS */}
        <div style={{ ...cardStyle, flex: 1 }}>
          <h2>Live System Logs</h2>
          <div style={{ height: '300px', overflowY: 'auto', background: '#000', color: '#0f0', padding: '10px', fontFamily: 'monospace' }}>
            {logs.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </div>

      </div>
    </div>
  );
}

// Simple Styles
const cardStyle = {
  background: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', width: '30%'
};

const btnStyle = {
  background: '#007bff', color: 'white', border: 'none', padding: '10px 20px', cursor: 'pointer', borderRadius: '5px'
};

export default App;