import axios from 'axios';
import { useEffect, useState, useCallback } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts';
import io from 'socket.io-client';
import './App.css';

import KPIBar from './components/KPIBar';
import EnergyChart from './components/EnergyChart';
import OperationalMetrics from './components/OperationalMetrics';
import TruckQueue from './components/TruckQueue';
import LiveLog from './components/LiveLog';
import CraneCoordinator from './components/CraneCoordinator';
import AnomalyDetector from './components/AnomalyDetector';
import PredictiveAnalytics from './components/PredictiveAnalytics';
import WhatIfSimulator from './components/WhatIfSimulator';

const SOCKET_SERVER = "http://localhost:3001";
const socket = io(SOCKET_SERVER);

function App() {
  // State for Scenario 1 (Inbound)
  const [containerId, setContainerId] = useState("BOX_001");
  const [weight, setWeight] = useState(25.0);
  const [aiPrediction, setAiPrediction] = useState(null);

  // Smart Inbound Features
  const [receivers, setReceivers] = useState([]);
  const [receiverId, setReceiverId] = useState("");
  const [inboundDate, setInboundDate] = useState(new Date().toISOString().split('T')[0]);
  const [predictedDate, setPredictedDate] = useState(null);
  const [useSuggestedDate, setUseSuggestedDate] = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);

  // State for Grid Visualization
  const [gridState, setGridState] = useState([]);

  // State for JIT Retrieval
  const [selectedContainer, setSelectedContainer] = useState(null);
  const [truckDistance, setTruckDistance] = useState(null); // null = no active retrieval
  const [retrievalStatus, setRetrievalStatus] = useState('idle'); // idle, approaching, dispatched, ready, complete

  // New: Metrics state
  const [metrics, setMetrics] = useState(null);
  const [energyAnalytics, setEnergyAnalytics] = useState(null);

  // What-If Simulator modal state
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const [metricsRes, energyRes] = await Promise.all([
        axios.get(`${SOCKET_SERVER}/api/metrics`),
        axios.get(`${SOCKET_SERVER}/api/metrics/energy`)
      ]);
      setMetrics(metricsRes.data);
      setEnergyAnalytics(energyRes.data);
    } catch (err) {
      console.error("Error fetching metrics:", err);
    }
  }, []);

  useEffect(() => {
    socket.on('connect_error', (err) => {
      console.error("❌ Socket Connection Error:", err.message);
      addLog(`❌ Connection Failed: ${err.message}`);
    });

    socket.on('connect', () => {
      console.log("✅ Socket Connected!", socket.id);
      addLog("✅ Connected to System Core");
      socket.emit('register', 'dashboard');
    });

    socket.on('grid_update', (newGridState) => {
      console.log("📦 Grid Update Received");
      setGridState(newGridState);
      fetchMetrics();
    });

    socket.on('prediction_alert', (data) => {
      setAiPrediction(data);
      addLog(`📦 Container ${data.containerId} placed. Energy: ${data.predictedNetKwh?.toFixed(3)} kWh`);
    });

    socket.on('metrics_update', () => {
      fetchMetrics();
    });

    axios.get(`${SOCKET_SERVER}/api/grid/status`)
      .then(res => setGridState(res.data))
      .catch(err => console.error("Failed to fetch grid", err));

    fetchMetrics();
    const metricsInterval = setInterval(fetchMetrics, 30000);

    if (socket.connected) {
      socket.emit('register', 'dashboard');
    }

    return () => {
      socket.off();
      clearInterval(metricsInterval);
    };
  }, [fetchMetrics]);

  useEffect(() => {
    axios.get(`${SOCKET_SERVER}/api/receivers`)
      .then(res => {
        const data = res.data || [];
        if (data.length > 0) {
          setReceivers(data);
          setReceiverId(data[0].id);
        }
      })
      .catch(err => console.error("Error fetching receivers:", err));
  }, []);

  const fetchPrediction = async (rId, iDate, w) => {
    if (!rId || !iDate) return;
    try {
      const res = await axios.post(`${SOCKET_SERVER}/api/inbound/predict`, {
        receiverId: rId,
        weight: parseFloat(w),
        commodity: "Auto"
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

  useEffect(() => {
    if (receiverId && inboundDate) {
      fetchPrediction(receiverId, inboundDate, weight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverId]);

  const addLog = useCallback((msg) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  }, []);

  const handleInbound = async () => {
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
        receiverId: receiverId || "RCVR_005",
        outboundDate: useSuggestedDate && predictedDate ? predictedDate.outbound : null
      });
      setContainerId(`BOX_${Math.floor(Math.random() * 1000)}`);
    } catch (err) {
      console.error(err);
      addLog(`❌ Error: ${err.message}`);
    }
  };

  // Click on container to start retrieval simulation
  const handleContainerClick = (slot) => {
    if (slot.status !== 'occupied') return;
    if (retrievalStatus !== 'idle' && retrievalStatus !== 'complete') return; // Already retrieving
    
    setSelectedContainer(slot);
    setTruckDistance(15); // Start truck 15km away
    setRetrievalStatus('approaching');
    addLog(`🚛 Truck dispatched for ${slot.containerId} (Row ${slot.row})`);
  };

  // Truck animation effect
  useEffect(() => {
    if (retrievalStatus !== 'approaching' && retrievalStatus !== 'dispatched' && retrievalStatus !== 'ready') return;
    if (truckDistance === null) return;

    const interval = setInterval(() => {
      setTruckDistance(prev => {
        if (prev === null) return null;
        
        const newDist = Math.max(0, prev - 0.5);
        const eta = newDist * 1.5; // minutes
        
        // Get retrieval time based on row (Row 1 = 1.5min, Row 2 = 2.5min, Row 3 = 4min)
        const retrievalTime = selectedContainer ? 
          (selectedContainer.row === 1 ? 1.5 : selectedContainer.row === 2 ? 2.5 : 4) : 3;
        
        // Dispatch crane when ETA matches retrieval time
        if (eta <= retrievalTime && retrievalStatus === 'approaching') {
          setRetrievalStatus('dispatched');
          addLog(`🏗️ Crane dispatched - retrieving ${selectedContainer?.containerId}`);
        }
        
        // Container ready when crane finishes (simulated)
        if (eta <= 0.5 && retrievalStatus === 'dispatched') {
          setRetrievalStatus('ready');
          addLog(`✅ ${selectedContainer?.containerId} ready at dock`);
        }
        
        // Complete when truck arrives
        if (newDist === 0) {
          setRetrievalStatus('complete');
          addLog(`🎉 ${selectedContainer?.containerId} loaded - Zero wait time!`);
          
          // Actually remove from grid
          if (selectedContainer) {
            axios.post(`${SOCKET_SERVER}/api/outbound/retrieve`, { 
              containerId: selectedContainer.containerId 
            }).catch(err => console.error(err));
          }
          
          // Reset after 3 seconds
          setTimeout(() => {
            setSelectedContainer(null);
            setTruckDistance(null);
            setRetrievalStatus('idle');
          }, 3000);
        }
        
        return newDist;
      });
    }, 500); // Update every 500ms

    return () => clearInterval(interval);
  }, [retrievalStatus, truckDistance, selectedContainer, addLog]);

  const handleResetGrid = async () => {
    try {
      await axios.post(`${SOCKET_SERVER}/api/grid/reset`);
      addLog("🔄 Grid reset successfully");
    } catch (err) {
      addLog(`❌ Reset failed: ${err.message}`);
    }
  };

  const renderGrid = (gridName) => {
    const gridSlots = gridState.filter(s => s.grid === gridName);

    const columns = [];

    columns.push(
      <div key="labels" className="rack-column" style={{ justifyContent: 'space-between', paddingBottom: '20px', marginRight: '8px' }}>
        <div style={{ height: '64px', display: 'flex', alignItems: 'center', color: '#94a3b8', fontSize: '0.7rem', justifyContent: 'flex-end', fontWeight: '600' }}>Row 3</div>
        <div style={{ height: '64px', display: 'flex', alignItems: 'center', color: '#94a3b8', fontSize: '0.7rem', justifyContent: 'flex-end', fontWeight: '600' }}>Row 2</div>
        <div style={{ height: '64px', display: 'flex', alignItems: 'center', color: '#94a3b8', fontSize: '0.7rem', justifyContent: 'flex-end', fontWeight: '600' }}>Row 1</div>
        <div style={{ height: '20px' }}></div>
      </div>
    );

    const numColumns = 5;

    for (let c = 1; c <= numColumns; c++) {
      const stackSlots = gridSlots.filter(s => s.column === c).sort((a, b) => b.row - a.row);

      columns.push(
        <div key={c} className="rack-column">
          {stackSlots.map(slot => {
            let tooltipText = `${slot.id}`;
            let bgColor = '';
            let textColor = 'white';

            if (slot.status === 'occupied') {
              const recName = receivers.find(rec => rec.id === slot.receiverId)?.name || slot.receiverId || 'Unknown';
              tooltipText = `📦 ID: ${slot.containerId}\n👤 Rec: ${recName}\n⚖️ Wt: ${slot.weight}T\n📅 Out: ${slot.expectedOutboundDate || 'N/A'}`;

              if (slot.expectedOutboundDate) {
                const now = new Date();
                const out = new Date(slot.expectedOutboundDate);
                const diffTime = out - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays <= 3) {
                  bgColor = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
                  tooltipText += `\n🚀 FAST MOVER (${diffDays} days)`;
                } else if (diffDays > 7) {
                  bgColor = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                  tooltipText += `\n🐢 SLOW MOVER (${diffDays} days)`;
                } else {
                  bgColor = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
                }
              } else {
                bgColor = 'linear-gradient(135deg, #64748b 0%, #475569 100%)';
              }
            }

            const isSelected = selectedContainer?.containerId === slot.containerId;
            const isRetrieving = isSelected && retrievalStatus !== 'idle';
            
            return (
              <div
                key={slot.id}
                className={`slot ${slot.status}${isSelected ? ' selected' : ''}`}
                data-tooltip={slot.status === 'occupied' ? `${tooltipText}\n\n🖱️ Click to retrieve` : tooltipText}
                onClick={() => handleContainerClick(slot)}
                style={{
                  ...(bgColor ? { background: bgColor, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' } : {}),
                  ...(isSelected ? { 
                    outline: '3px solid #10b981', 
                    outlineOffset: '2px',
                    animation: isRetrieving ? 'pulse 1s infinite' : 'none'
                  } : {}),
                  cursor: slot.status === 'occupied' && retrievalStatus === 'idle' ? 'pointer' : 'default',
                  transition: 'all 0.2s ease'
                }}
              >
                {slot.status === 'occupied' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontWeight: '600', color: textColor, fontSize: '0.65rem' }}>{slot.containerId}</span>
                    {isRetrieving && (
                      <span style={{ fontSize: '0.5rem', marginTop: '2px' }}>
                        {retrievalStatus === 'approaching' ? '🚛' : retrievalStatus === 'dispatched' ? '🏗️' : '✅'}
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.6rem' }}>{gridName}{c}-{slot.row}</span>
                )}
              </div>
            );
          })}
          <div style={{ textAlign: 'center', fontSize: '0.65rem', marginTop: '8px', color: '#94a3b8', fontWeight: '600' }}>Col {c}</div>
        </div>
      );
    }
    return columns;
  };

  return (
    <div className="App">
      {/* HEADER */}
      <div style={{ 
        padding: '16px 32px', 
        background: '#ffffff', 
        borderBottom: '1px solid #e2e8f0', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', 
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem'
          }}>
            🏭
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#0f172a' }}>
              BoxBay Digital Twin
            </h1>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>Control Tower</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px',
            padding: '8px 16px',
            background: socket.connected ? '#ecfdf5' : '#fef2f2',
            border: `1px solid ${socket.connected ? '#a7f3d0' : '#fecaca'}`,
            borderRadius: '20px'
          }}>
            <span style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              background: socket.connected ? '#10b981' : '#ef4444' 
            }}></span>
            <span style={{ 
              fontSize: '0.8rem', 
              fontWeight: '500', 
              color: socket.connected ? '#047857' : '#dc2626' 
            }}>
              {socket.connected ? "Online" : "Offline"}
            </span>
          </div>
          <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{new Date().toLocaleString()}</span>
          <button 
            onClick={() => setIsSimulatorOpen(true)}
            style={{ 
              padding: '8px 16px', 
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
              border: 'none', 
              borderRadius: '8px', 
              color: '#ffffff', 
              cursor: 'pointer', 
              fontSize: '0.8rem',
              fontWeight: '600',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 8px rgba(139, 92, 246, 0.3)'
            }}
          >
            🔬 What-If Simulator
          </button>
          <button 
            onClick={handleResetGrid}
            style={{ 
              padding: '8px 16px', 
              background: '#f1f5f9', 
              border: '1px solid #e2e8f0', 
              borderRadius: '8px', 
              color: '#64748b', 
              cursor: 'pointer', 
              fontSize: '0.8rem',
              fontWeight: '500',
              transition: 'all 0.2s ease'
            }}
          >
            Reset Grid
          </button>
        </div>
      </div>

      <div style={{ padding: '24px 32px', maxWidth: '1600px', margin: '0 auto' }}>
        <div style={{ marginBottom: '8px' }}></div>

        {/* KPI BAR */}
        <KPIBar metrics={metrics} />

        {/* GRID VISUALIZATION */}
        <div className="grid-container">
          <div className="grid-rack">
            <h3>Grid A</h3>
            <div className="rack-rows">
              {renderGrid('A')}
            </div>
          </div>

          <div className="crane-tower">
            CRANE
          </div>

          <div className="grid-rack">
            <h3>Grid B</h3>
            <div className="rack-rows">
              {renderGrid('B')}
            </div>
          </div>
        </div>

        {/* AI FEATURES ROW */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
          <CraneCoordinator 
            gridState={gridState}
            addLog={addLog}
          />
          <AnomalyDetector 
            gridState={gridState}
            energyData={energyAnalytics}
            metrics={metrics}
          />
        </div>

        {/* ANALYTICS ROW */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
          <PredictiveAnalytics 
            gridState={gridState}
            currentUtilization={metrics?.capacity?.utilizationPct || 0}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <EnergyChart 
              hourlyData={energyAnalytics?.hourly || []}
              savedKwh={metrics?.energy?.savedKwh}
              savedPct={metrics?.energy?.savedPct}
            />
            <OperationalMetrics metrics={metrics} />
          </div>
        </div>

        {/* CONTROL PANELS */}
        <div className="control-panel">
          {/* PANEL 1: INBOUND CONTROLS */}
          <div className="control-card">
            <h2>Scenario 1: Smart Inbound</h2>

            <div style={{ marginBottom: '12px' }}>
              <label>Select Receiver</label>
              <select
                value={receiverId}
                onChange={e => handleReceiverChange(e.target.value)}
              >
                {receivers.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} - ⭐ {r.rating}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label>Inbound Date</label>
              <input
                type="date"
                value={inboundDate}
                onChange={handleDateChange}
              />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <label>Weight (Tons): </label>
              <input type="number" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>

            {predictedDate && (
              <div style={{ 
                marginBottom: '16px', 
                padding: '16px', 
                background: 'linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)', 
                borderRadius: '12px', 
                border: '1px solid #a5f3fc' 
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '1.25rem' }}>🤖</span>
                  <strong style={{ color: '#0e7490', fontSize: '0.9rem' }}>AI Prediction</strong>
                </div>
                <div style={{ color: '#0f172a', fontSize: '1.1rem', fontWeight: '600' }}>
                  Est. Dwell Time: {predictedDate.days} Days
                </div>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>
                  Suggested Outbound: {predictedDate.outbound}
                </div>

                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid #a5f3fc', display: 'flex', justifyContent: 'center' }}>
                  <label style={{ 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    userSelect: 'none', 
                    background: '#ffffff', 
                    padding: '8px 16px', 
                    borderRadius: '20px', 
                    border: '1px solid #06b6d4',
                    transition: 'all 0.2s ease'
                  }}>
                    <input
                      type="checkbox"
                      checked={useSuggestedDate}
                      onChange={e => setUseSuggestedDate(e.target.checked)}
                      style={{ marginRight: '8px', width: '16px', height: '16px', accentColor: '#06b6d4' }}
                    />
                    <span style={{ fontSize: '0.85rem', color: '#0e7490', fontWeight: '600' }}>Use Suggested Date</span>
                  </label>
                </div>
              </div>
            )}

            <button onClick={handleInbound}>Optimize & Store {useSuggestedDate ? '(with AI Date)' : ''}</button>

            {aiPrediction && (
              <div style={{ 
                marginTop: '16px', 
                padding: '16px', 
                background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', 
                borderRadius: '12px', 
                border: '1px solid #a7f3d0' 
              }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#047857', fontWeight: '600' }}>
                  ⚡ Energy Analysis
                </h3>
                <BarChart width={280} height={140} data={[
                  { name: 'Lift', kwh: aiPrediction.details?.lift || 0 },
                  { name: 'Regen', kwh: aiPrediction.details?.regen || 0 },
                  { name: 'Net', kwh: aiPrediction.predictedNetKwh || 0 }
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d1fae5" />
                  <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px' }} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="kwh" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
                <p style={{ marginTop: '12px', fontWeight: '700', color: '#047857', fontSize: '1rem' }}>
                  Est. Savings: {aiPrediction.savings}
                </p>
              </div>
            )}
          </div>

          {/* PANEL 2: TRUCK QUEUE STATUS */}
          <div className="control-card">
            <TruckQueue avgWaitTime={2.1} />
          </div>

          {/* PANEL 3: JIT RETRIEVAL STATUS */}
          <div className="control-card">
            <h2>JIT Retrieval</h2>
            <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '20px' }}>
              Click any container in the grid to simulate retrieval
            </p>

            {!selectedContainer ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '40px 20px',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px dashed #e2e8f0'
              }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🖱️</div>
                <div style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: '500' }}>
                  Select a container from the grid
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '4px' }}>
                  Click on any colored box to start retrieval
                </div>
              </div>
            ) : (
              <div>
                {/* Selected Container Info */}
                <div style={{ 
                  padding: '16px', 
                  background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                  borderRadius: '12px',
                  border: '1px solid #7dd3fc',
                  marginBottom: '16px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#0369a1', fontWeight: '500' }}>Retrieving</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#0c4a6e' }}>
                        {selectedContainer.containerId}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.75rem', color: '#0369a1' }}>Row {selectedContainer.row}</div>
                      <div style={{ fontSize: '0.85rem', color: '#0c4a6e' }}>
                        ~{selectedContainer.row === 1 ? '1.5' : selectedContainer.row === 2 ? '2.5' : '4'} min retrieval
                      </div>
                    </div>
                  </div>
                </div>

                {/* Truck Progress */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Truck Distance</span>
                    <span style={{ fontSize: '1rem', fontWeight: '700', color: '#0f172a' }}>
                      {truckDistance?.toFixed(1) || 0} km
                    </span>
                  </div>
                  <div style={{ 
                    height: '8px', 
                    background: '#e2e8f0', 
                    borderRadius: '4px', 
                    overflow: 'hidden',
                    position: 'relative'
                  }}>
                    <div style={{ 
                      position: 'absolute',
                      right: 0,
                      height: '100%',
                      width: `${((15 - (truckDistance || 0)) / 15) * 100}%`,
                      background: 'linear-gradient(90deg, #3b82f6 0%, #10b981 100%)',
                      borderRadius: '4px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    marginTop: '4px',
                    fontSize: '0.7rem',
                    color: '#94a3b8'
                  }}>
                    <span>🏭 Yard</span>
                    <span>🚛 Truck</span>
                  </div>
                </div>

                {/* Status Timeline */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { key: 'approaching', icon: '🚛', label: 'Truck En Route', active: retrievalStatus === 'approaching' },
                    { key: 'dispatched', icon: '🏗️', label: 'Crane Dispatched', active: retrievalStatus === 'dispatched' },
                    { key: 'ready', icon: '✅', label: 'Container Ready', active: retrievalStatus === 'ready' },
                    { key: 'complete', icon: '🎉', label: 'Loaded - Zero Wait!', active: retrievalStatus === 'complete' }
                  ].map((step, i) => {
                    const isPast = ['approaching', 'dispatched', 'ready', 'complete'].indexOf(retrievalStatus) > i;
                    const isCurrent = step.active;
                    
                    return (
                      <div key={step.key} style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '12px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: isCurrent ? 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)' : 
                                   isPast ? '#f8fafc' : '#ffffff',
                        border: isCurrent ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
                        opacity: isPast || isCurrent ? 1 : 0.5
                      }}>
                        <span style={{ fontSize: '1.25rem' }}>{step.icon}</span>
                        <span style={{ 
                          fontSize: '0.85rem', 
                          fontWeight: isCurrent ? '600' : '400',
                          color: isCurrent ? '#047857' : isPast ? '#64748b' : '#94a3b8'
                        }}>
                          {step.label}
                        </span>
                        {isCurrent && (
                          <span style={{ 
                            marginLeft: 'auto', 
                            fontSize: '0.7rem', 
                            color: '#10b981',
                            fontWeight: '600'
                          }}>
                            ACTIVE
                          </span>
                        )}
                        {isPast && (
                          <span style={{ marginLeft: 'auto', color: '#10b981' }}>✓</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* PANEL 4: LIVE LOG */}
          <div className="control-card">
            <LiveLog logs={logs} />
          </div>
        </div>
      </div>

      {/* What-If Simulator Modal */}
      <WhatIfSimulator 
        gridState={gridState}
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
      />
    </div>
  );
}

export default App;
