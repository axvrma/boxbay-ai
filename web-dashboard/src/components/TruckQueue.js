import React from 'react';

const TruckItem = ({ truck, isNext }) => {
  const statusStyles = {
    en_route: { color: '#f59e0b', bg: '#fffbeb', border: '#fde68a' },
    dispatched: { color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
    delivered: { color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' }
  };

  const statusIcons = {
    en_route: '🚛',
    dispatched: '🏗️',
    delivered: '✅'
  };

  const style = statusStyles[truck.status] || statusStyles.en_route;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 14px',
      borderRadius: '10px',
      background: isNext ? style.bg : '#f8fafc',
      border: `1px solid ${isNext ? style.border : '#e2e8f0'}`,
      transition: 'all 0.2s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '1.25rem' }}>{statusIcons[truck.status]}</span>
        <div>
          <div style={{ color: '#0f172a', fontWeight: '600', fontSize: '0.9rem' }}>{truck.truckId}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{truck.containerId}</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: '700', color: style.color, fontSize: '0.9rem' }}>
          {truck.status === 'delivered' ? 'Done' : `${Math.round(truck.eta)} min`}
        </div>
        {truck.status === 'en_route' && (
          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{truck.distance} km</div>
        )}
      </div>
    </div>
  );
};

const TruckQueue = ({ trucks = [], avgWaitTime = 0 }) => {
  const activeTrucks = trucks.filter(t => t.status !== 'delivered');
  
  const mockTrucks = activeTrucks.length === 0 ? [
    { id: 1, truckId: 'TRK-441', containerId: 'BOX_089', eta: 3, distance: 2, status: 'dispatched' },
    { id: 2, truckId: 'TRK-228', containerId: 'BOX_156', eta: 12, distance: 8, status: 'en_route' },
    { id: 3, truckId: 'TRK-891', containerId: 'BOX_203', eta: 25, distance: 17, status: 'en_route' },
  ] : activeTrucks;

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
      height: '100%'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.1rem', fontWeight: '600' }}>
          Truck Queue
        </h3>
        <span style={{ 
          fontSize: '0.7rem', 
          color: '#64748b', 
          background: '#f1f5f9', 
          padding: '4px 10px', 
          borderRadius: '20px',
          fontWeight: '500'
        }}>
          {mockTrucks.length} pending
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
        {mockTrucks.map((truck, index) => (
          <TruckItem 
            key={truck.id || index} 
            truck={truck} 
            isNext={index === 0 && truck.status === 'dispatched'}
          />
        ))}
      </div>

      <div style={{ 
        marginTop: '16px', 
        paddingTop: '16px', 
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: '500' }}>Avg Wait Time</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ 
            fontWeight: '700', 
            color: avgWaitTime <= 5 ? '#10b981' : '#f59e0b',
            fontSize: '1rem'
          }}>
            {avgWaitTime.toFixed(1)} min
          </span>
          {avgWaitTime <= 5 && <span style={{ color: '#10b981' }}>✓</span>}
        </div>
      </div>
      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>
        Target: &lt; 5 min
      </div>
    </div>
  );
};

export default TruckQueue;
