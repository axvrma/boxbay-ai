import axios from 'axios';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import io from 'socket.io-client';
import './App.css';

const SOCKET_SERVER = "http://localhost:3000";
const socket = io(SOCKET_SERVER);

function App () {
  // State for Scenario 1 (Inbound)
  const [containerId, setContainerId] = useState("BOX_001"); // Still used for backend tracking
  const [weight, setWeight] = useState(25.0);
  const [aiPrediction, setAiPrediction] = useState(null);

  // Smart Inbound Features
  const [receivers, setReceivers] = useState([]);
  const [receiverId, setReceiverId] = useState("");
  const [inboundDate, setInboundDate] = useState(new Date().toISOString().split('T')[0]);
  const [predictedDate, setPredictedDate] = useState(null);
  const [useSuggestedDate, setUseSuggestedDate] = useState(false);

  // State for Scenario 2 (GPS)
  const [distance, setDistance] = useState(10.0); // km
  const [truckStatus, setTruckStatus] = useState("En Route");

  // Logs
  const [logs, setLogs] = useState([]);

  // State for Grid Visualization
  const [gridState, setGridState] = useState([]);

  useEffect(() => {
    // Debugging: Log connection attempts
    socket.on('connect_error', (err) => {
      console.error("❌ Socket Connection Error:", err.message);
      addLog(`❌ Connection Failed: ${err.message}`);
    });

    socket.on('connect', () => {
      console.log("✅ Socket Connected!", socket.id);
      addLog("✅ Connected to System Core");
      socket.emit('register', 'dashboard');
    });

    // Listen for Grid Updates
    socket.on('grid_update', (newGridState) => {
      console.log("📦 Grid Update Received");
      setGridState(newGridState);
    });

    // Listen for Prediction Alerts
    socket.on('prediction_alert', (data) => {
      setAiPrediction(data);
    });

    // Initial Fetch of Grid State
    axios.get(`${SOCKET_SERVER}/api/grid/status`)
      .then(res => setGridState(res.data))
      .catch(err => console.error("Failed to fetch grid", err));

    // Force register if already connected on load
    if (socket.connected) {
      socket.emit('register', 'dashboard');
    }

    return () => socket.off(); // Cleanup
    return () => socket.off(); // Cleanup
  }, []);

  // --- FETCH RECEIVERS ---
  useEffect(() => {
    axios.get(`${SOCKET_SERVER}/api/receivers`)
      .then(res => {
        const data = res.data || [];
        if (data.length > 0) {
          setReceivers(data);
          setReceiverId(data[0].id); // Default to first
        }
      })
      .catch(err => console.error("Error fetching receivers:", err));
  }, []);

  // --- DWELL TIME PREDICTION LOGIC ---
  const fetchPrediction = async (rId, iDate, w) => {
    if (!rId || !iDate) return;
    try {
      const res = await axios.post(`${SOCKET_SERVER}/api/inbound/predict`, {
        receiverId: rId,
        weight: parseFloat(w),
        commodity: "Auto" // Default for POC
      });

      if (res.data && res.data.predictedDate) {
        const days = res.data.predictedDate;
        const dateObj = new Date(iDate);
        dateObj.setDate(dateObj.getDate() + Math.ceil(days));

        setPredictedDate({
          days: days,
          outbound: dateObj.toISOString().split('T')[0]
        });
      }
    } catch (err) {
      console.error("Prediction Error:", err);
    }
  };

  const handleReceiverChange = (id) => {
    setReceiverId(id);
    fetchPrediction(id, inboundDate, weight);
  };

  const handleDateChange = (e) => {
    const date = e.target.value;
    setInboundDate(date);
    fetchPrediction(receiverId, date, weight);
  };

  // Trigger prediction on initial load (once we have receivers)
  useEffect(() => {
    if (receiverId && inboundDate) {
      fetchPrediction(receiverId, inboundDate, weight);
    }
  }, [receiverId]); // Dependency on receiverId ensures it runs after fetch

  const addLog = (msg) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  // --- HANDLERS ---
  const handleInbound = async () => {
    // FAILSAFE 1: Force re-registration right before asking
    console.log("Re-registering as dashboard...");
    socket.emit('register', 'dashboard');

    if (!weight || !containerId) {
      alert("Please enter Container ID and Weight");
      return;
    }

    addLog(`📦 Sending Inbound Request for ${containerId}...`);

    try {
      await axios.post(`${SOCKET_SERVER}/api/inbound/optimize`, {
        containerId,
        weight: parseFloat(weight),
        receiverId: receiverId || "RCVR_005", // Use selected or fallback
        outboundDate: useSuggestedDate && predictedDate ? predictedDate.outbound : null
      });
      setContainerId(`BOX_${Math.floor(Math.random() * 1000)}`); // Auto-generate next ID
    } catch (err) {
      console.error(err);
      addLog(`❌ Error: ${err.message}`);
    }
  };

  const handleSliderChange = async (e) => {
    const val = parseFloat(e.target.value);
    setDistance(val);

    // Send GPS Update (Not fully implemented in backend yet, but UI is ready)
  };

  // Helper to render a Grid
  const renderGrid = (gridName) => {
    // Filter slots for this grid
    const gridSlots = gridState.filter(s => s.grid === gridName);
    const rows = 4;

    const columns = [];

    // Add Row Labels (Vertical Axis) - Columns 3, 2, 1
    columns.push(
      <div key="labels" className="rack-column" style={{ justifyContent: 'space-between', paddingBottom: '20px', marginRight: '10px' }}>
        <div style={{ height: '70px', display: 'flex', alignItems: 'center', color: '#666', fontSize: '0.8rem', justifyContent: 'flex-end', fontWeight: 'bold' }}>Col 3</div>
        <div style={{ height: '70px', display: 'flex', alignItems: 'center', color: '#666', fontSize: '0.8rem', justifyContent: 'flex-end', fontWeight: 'bold' }}>Col 2</div>
        <div style={{ height: '70px', display: 'flex', alignItems: 'center', color: '#666', fontSize: '0.8rem', justifyContent: 'flex-end', fontWeight: 'bold' }}>Col 1</div>
        <div style={{ height: '20px' }}></div>
      </div>
    );

    for (let r = 1; r <= rows; r++) {
      // Sort by Column (vertical height)
      const rowSlots = gridSlots.filter(s => s.row === r).sort((a, b) => a.column - b.column);
      columns.push(
        <div key={r} className="rack-column">
          {rowSlots.map(slot => {
            // Build Tooltip text
            let tooltipText = `${slot.id}`;
            if (slot.status === 'occupied') {
              const recName = receivers.find(rec => rec.id === slot.receiverId)?.name || slot.receiverId || 'Unknown';
              tooltipText = `📦 ID: ${slot.containerId}\n👤 Rec: ${recName}\n⚖️ Wt: ${slot.weight}T\n📅 Out: ${slot.expectedOutboundDate || 'N/A'}`;
            }

            return (
              <div
                key={slot.id}
                className={`slot ${slot.status}`}
                data-tooltip={tooltipText}
              >
                {slot.status === 'occupied' ? slot.containerId : `${gridName}${r}${slot.column}`}
              </div>
            );
          })}
          <div style={{ textAlign: 'center', fontSize: '10px', marginTop: '5px', color: '#888', fontWeight: 'bold' }}>Row {r}</div>
        </div>
      );
    }
    return columns;
  };

  return (
    <div className="App">

      {/* STATUS BAR */}
      <div style={{ padding: '10px', marginBottom: '20px', background: socket.connected ? '#1e1e2f' : '#2a1a1a', color: socket.connected ? '#4caf50' : '#f44336', borderBottom: '1px solid #333' }}>
        <strong>System Status: </strong>
        {socket.connected ? "🟢 ONLINE (Connected to Brain)" : "🔴 OFFLINE (Socket Disconnected)"}
      </div>

      <h1>🏭 BoxBay Digital Twin Control Tower</h1>

      {/* --- GRID VISUALIZATION --- */}
      <div className="grid-container">
        <div className="grid-rack">
          <h3>Grid A</h3>
          <div className="rack-rows">
            {renderGrid('A')}
          </div>
        </div>

        {/* Crane Representation */}
        <div className="crane-tower">
          STACKER CRANE
        </div>

        <div className="grid-rack">
          <h3>Grid B</h3>
          <div className="rack-rows">
            {renderGrid('B')}
          </div>
        </div>
      </div>

      <div className="control-panel">

        {/* PANEL 1: INBOUND CONTROLS (SMART INBOUND) */}
        <div className="control-card">
          <h2>Scenario 1: Smart Inbound</h2>

          <div style={{ marginBottom: '10px' }}>
            <label>Select Receiver: </label>
            <select
              value={receiverId}
              onChange={e => handleReceiverChange(e.target.value)}
              style={{ width: '100%', padding: '10px', background: '#1e1e2f', color: 'white', border: '1px solid #555', borderRadius: '6px' }}
            >
              {receivers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} - ⭐ {r.rating} ({r.id})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label>Inbound Date: </label>
            <input
              type="date"
              value={inboundDate}
              onChange={handleDateChange}
              style={{ width: '100%', padding: '10px', background: '#1e1e2f', color: 'white', border: '1px solid #555', borderRadius: '6px' }}
            />
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label>Weight (Tons): </label>
            <input type="number" value={weight} onChange={e => setWeight(e.target.value)} />
          </div>

          {predictedDate && (
            <div style={{ marginBottom: '15px', padding: '10px', background: 'rgba(0, 200, 255, 0.1)', borderRadius: '5px', border: '1px solid #00acc1' }}>
              <strong style={{ color: '#4dd0e1' }}>🤖 AI Prediction:</strong><br />
              Est. Dwell Time: {predictedDate.days} Days<br />
              <span style={{ fontSize: '0.9rem', color: '#ccc' }}>Suggested Outbound: {predictedDate.outbound}</span>

              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', justifyContent: 'center' }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', userSelect: 'none', background: 'rgba(0,0,0,0.2)', padding: '5px 10px', borderRadius: '15px', border: '1px solid #00ACC1' }}>
                  <input
                    type="checkbox"
                    checked={useSuggestedDate}
                    onChange={e => setUseSuggestedDate(e.target.checked)}
                    style={{ marginRight: '8px', width: '16px', height: '16px', accentColor: '#00ACC1' }}
                  />
                  <span style={{ fontSize: '0.9rem', color: '#E0F7FA', fontWeight: 'bold' }}>Use Suggested Date</span>
                </label>
              </div>
            </div>
          )}

          <button onClick={handleInbound}>Optimize & Store {useSuggestedDate ? '(with AI Date)' : ''}</button>

          {aiPrediction && (
            <div style={{ marginTop: '20px', padding: '10px', background: 'rgba(46, 125, 50, 0.1)', borderRadius: '5px', border: '1px solid #2e7d32' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#4caf50' }}>Energy Analysis</h3>
              <BarChart width={280} height={150} data={[
                { name: 'Lift', kwh: aiPrediction.details?.lift || 0 },
                { name: 'Regen', kwh: aiPrediction.details?.regen || 0 },
                { name: 'Net', kwh: aiPrediction.predictedNetKwh || 0 }
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis dataKey="name" stroke="#888" tick={{ fontSize: 10 }} />
                <YAxis stroke="#888" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#2a2a40', borderColor: '#444', color: '#fff' }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="kwh" fill="#82ca9d" />
              </BarChart>
              <p style={{ marginTop: '10px', fontWeight: 'bold', color: '#4caf50' }}>Est. Savings: {aiPrediction.savings}</p>
            </div>
          )}
        </div>

        {/* PANEL 2: GPS CONTROLS */}
        <div className="control-card">
          <h2>Scenario 2: Just-in-Time Retrieval</h2>
          <p>Truck Distance: <strong>{distance} km</strong></p>
          <input
            type="range"
            min="0" max="10" step="0.5"
            value={distance}
            onChange={handleSliderChange}
            style={{ width: '100%' }}
          />
          <div style={{ marginTop: '20px', padding: '10px', borderRadius: '4px', background: truckStatus === "CRANE DISPATCHED" ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: truckStatus === "CRANE DISPATCHED" ? '#f44336' : '#aaa' }}>
            Status: <strong>{truckStatus}</strong>
          </div>
        </div>

        {/* PANEL 3: LIVE LOGS */}
        <div className="control-card" style={{ flex: 1 }}>
          <h2>Live System Logs</h2>
          <div className="log-window">
            {logs.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </div>

      </div>
    </div>
  );
}

export default App;