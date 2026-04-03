import React, { useState, useEffect, useCallback } from 'react';

const RETRIEVAL_TIME_BY_ROW = {
  1: 1.5,  // Row 1 (bottom) - fastest access
  2: 2.5,  // Row 2 (middle)
  3: 4.0   // Row 3 (top) - slowest access
};

const TruckItem = ({ truck, isActive, onSelect, isSelected }) => {
  const statusConfig = {
    scheduled: { color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', icon: '📋', label: 'Scheduled' },
    queued: { color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', icon: '🕐', label: 'Queued' },
    dispatched: { color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', icon: '🏗️', label: 'Crane Active' },
    ready: { color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0', icon: '✅', label: 'Ready' },
    delivered: { color: '#94a3b8', bg: '#f1f5f9', border: '#e2e8f0', icon: '🎉', label: 'Delivered' }
  };

  const config = statusConfig[truck.status] || statusConfig.scheduled;

  return (
    <div 
      onClick={() => onSelect && onSelect(truck)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        borderRadius: '12px',
        background: isSelected ? config.bg : '#ffffff',
        border: `2px solid ${isSelected ? config.color : config.border}`,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        opacity: truck.status === 'delivered' ? 0.6 : 1
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{
          width: '40px',
          height: '40px',
          borderRadius: '10px',
          background: config.bg,
          border: `1px solid ${config.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.25rem'
        }}>
          {config.icon}
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#0f172a', fontWeight: '600', fontSize: '0.95rem' }}>
              {truck.truckId}
            </span>
            <span style={{
              fontSize: '0.65rem',
              padding: '2px 8px',
              borderRadius: '10px',
              background: config.bg,
              color: config.color,
              fontWeight: '600',
              border: `1px solid ${config.border}`
            }}>
              {config.label}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
            {truck.containerId} • Row {truck.row}
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: '700', color: config.color, fontSize: '1.1rem' }}>
          {truck.status === 'delivered' ? '✓' : `${Math.max(0, Math.round(truck.eta))} min`}
        </div>
        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
          {truck.status === 'dispatched' ? 'Retrieving...' : 
           truck.status === 'ready' ? 'Container ready!' :
           truck.status === 'delivered' ? 'Complete' :
           `Dispatch at ${Math.max(0, Math.round(truck.dispatchAt))} min`}
        </div>
      </div>
    </div>
  );
};

const SmartTruckQueue = ({ gridState = [], onTruckSelect, addLog }) => {
  const [trucks, setTrucks] = useState([]);
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [stats, setStats] = useState({ trucksToday: 0, avgWait: 0, zeroWaitPct: 0 });

  // Get occupied containers from grid
  const occupiedSlots = gridState.filter(s => s.status === 'occupied');

  // Calculate retrieval time based on row
  const getRetrievalTime = (row) => RETRIEVAL_TIME_BY_ROW[row] || 2.5;

  // Add a new truck to the queue
  const addTruck = useCallback(() => {
    if (occupiedSlots.length === 0) {
      if (addLog) addLog('⚠️ No containers in grid to retrieve');
      return;
    }

    // Pick a random container that's not already in queue
    const inQueueIds = trucks.filter(t => t.status !== 'delivered').map(t => t.containerId);
    const available = occupiedSlots.filter(s => !inQueueIds.includes(s.containerId));
    
    if (available.length === 0) {
      if (addLog) addLog('⚠️ All containers already in queue');
      return;
    }

    const slot = available[Math.floor(Math.random() * available.length)];
    const etaMinutes = Math.floor(Math.random() * 15) + 5; // 5-20 min ETA
    const retrievalTime = getRetrievalTime(slot.row);
    const dispatchAt = Math.max(0, etaMinutes - retrievalTime);

    const newTruck = {
      id: Date.now(),
      truckId: `TRK-${Math.floor(Math.random() * 900) + 100}`,
      containerId: slot.containerId,
      row: slot.row,
      eta: etaMinutes,
      originalEta: etaMinutes,
      retrievalTime,
      dispatchAt,
      status: etaMinutes > retrievalTime + 2 ? 'scheduled' : 'queued',
      addedAt: Date.now()
    };

    setTrucks(prev => [...prev, newTruck]);
    if (addLog) addLog(`🚛 Truck ${newTruck.truckId} added to queue (ETA: ${etaMinutes} min)`);
  }, [occupiedSlots, trucks, addLog]);

  // Simulation tick - update truck states
  useEffect(() => {
    const interval = setInterval(() => {
      setTrucks(prev => {
        return prev.map(truck => {
          if (truck.status === 'delivered') return truck;

          const newEta = truck.eta - 0.1; // Decrease ETA
          const newDispatchAt = truck.dispatchAt - 0.1;
          
          let newStatus = truck.status;

          // State transitions
          if (newEta <= 0) {
            newStatus = 'delivered';
            if (addLog && truck.status !== 'delivered') {
              addLog(`🎉 ${truck.truckId} delivered - Wait time: 0 min`);
            }
          } else if (newEta <= truck.retrievalTime && truck.status !== 'ready') {
            if (truck.status === 'dispatched') {
              newStatus = 'ready';
              if (addLog) addLog(`✅ ${truck.containerId} ready for ${truck.truckId}`);
            }
          } else if (newDispatchAt <= 0 && truck.status !== 'dispatched' && truck.status !== 'ready') {
            newStatus = 'dispatched';
            if (addLog) addLog(`🏗️ Crane dispatched for ${truck.containerId}`);
          } else if (newDispatchAt <= 2 && truck.status === 'scheduled') {
            newStatus = 'queued';
          }

          return {
            ...truck,
            eta: newEta,
            dispatchAt: newDispatchAt,
            status: newStatus
          };
        });
      });
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, [addLog]);

  // Calculate stats
  useEffect(() => {
    const delivered = trucks.filter(t => t.status === 'delivered');
    const active = trucks.filter(t => t.status !== 'delivered');
    
    setStats({
      trucksToday: trucks.length,
      avgWait: delivered.length > 0 ? 0 : 0, // In this simulation, wait is always 0
      zeroWaitPct: delivered.length > 0 ? 100 : (active.length > 0 ? 95 : 0)
    });
  }, [trucks]);

  const handleSelect = (truck) => {
    setSelectedTruck(truck.id === selectedTruck?.id ? null : truck);
    if (onTruckSelect) onTruckSelect(truck);
  };

  // Clean up delivered trucks after 10 seconds
  useEffect(() => {
    const cleanup = setInterval(() => {
      setTrucks(prev => prev.filter(t => 
        t.status !== 'delivered' || Date.now() - t.addedAt < 30000
      ));
    }, 5000);
    return () => clearInterval(cleanup);
  }, []);

  const activeTrucks = trucks.filter(t => t.status !== 'delivered');
  const recentDelivered = trucks.filter(t => t.status === 'delivered').slice(-2);

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.1rem', fontWeight: '600' }}>
            Smart Truck Queue
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            JIT coordination with predictive dispatch
          </p>
        </div>
        <button
          onClick={addTruck}
          disabled={occupiedSlots.length === 0}
          style={{
            padding: '10px 20px',
            background: occupiedSlots.length === 0 
              ? '#e2e8f0' 
              : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            color: occupiedSlots.length === 0 ? '#94a3b8' : 'white',
            border: 'none',
            borderRadius: '10px',
            fontSize: '0.85rem',
            fontWeight: '600',
            cursor: occupiedSlots.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: occupiedSlots.length === 0 ? 'none' : '0 2px 8px rgba(59, 130, 246, 0.3)'
          }}
        >
          + Add Truck
        </button>
      </div>

      {/* Stats Bar */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(3, 1fr)', 
        gap: '12px', 
        marginBottom: '20px' 
      }}>
        <div style={{ 
          background: '#f8fafc', 
          borderRadius: '10px', 
          padding: '12px', 
          textAlign: 'center',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0f172a' }}>
            {stats.trucksToday}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Trucks Today</div>
        </div>
        <div style={{ 
          background: '#ecfdf5', 
          borderRadius: '10px', 
          padding: '12px', 
          textAlign: 'center',
          border: '1px solid #a7f3d0'
        }}>
          <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#047857' }}>
            {stats.avgWait} min
          </div>
          <div style={{ fontSize: '0.7rem', color: '#047857', fontWeight: '500' }}>Avg Wait</div>
        </div>
        <div style={{ 
          background: '#eff6ff', 
          borderRadius: '10px', 
          padding: '12px', 
          textAlign: 'center',
          border: '1px solid #bfdbfe'
        }}>
          <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1d4ed8' }}>
            {stats.zeroWaitPct}%
          </div>
          <div style={{ fontSize: '0.7rem', color: '#1d4ed8', fontWeight: '500' }}>Zero-Wait</div>
        </div>
      </div>

      {/* Queue List */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '10px',
        maxHeight: '300px',
        overflowY: 'auto'
      }}>
        {activeTrucks.length === 0 && recentDelivered.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '40px 20px',
            color: '#94a3b8',
            background: '#f8fafc',
            borderRadius: '12px',
            border: '1px dashed #e2e8f0'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🚛</div>
            <div style={{ fontSize: '0.9rem', fontWeight: '500' }}>No trucks in queue</div>
            <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
              Add containers first, then click "Add Truck"
            </div>
          </div>
        ) : (
          <>
            {activeTrucks.map(truck => (
              <TruckItem 
                key={truck.id} 
                truck={truck} 
                isSelected={selectedTruck?.id === truck.id}
                onSelect={handleSelect}
              />
            ))}
            {recentDelivered.map(truck => (
              <TruckItem 
                key={truck.id} 
                truck={truck} 
                isSelected={false}
                onSelect={() => {}}
              />
            ))}
          </>
        )}
      </div>

      {/* Legend */}
      <div style={{ 
        marginTop: '16px', 
        paddingTop: '16px', 
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'center',
        gap: '16px',
        flexWrap: 'wrap'
      }}>
        {[
          { icon: '📋', label: 'Scheduled' },
          { icon: '🕐', label: 'Queued' },
          { icon: '🏗️', label: 'Crane Active' },
          { icon: '✅', label: 'Ready' }
        ].map(item => (
          <div key={item.label} style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '4px',
            fontSize: '0.7rem',
            color: '#64748b'
          }}>
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SmartTruckQueue;
