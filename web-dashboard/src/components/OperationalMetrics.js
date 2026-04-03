import React from 'react';

const MetricGauge = ({ label, value, max = 100 }) => {
  const percentage = Math.min((value / max) * 100, 100);
  
  const getColor = () => {
    if (label.includes('Violations')) {
      return value === 0 ? '#10b981' : value <= 2 ? '#f59e0b' : '#ef4444';
    }
    if (percentage >= 90) return '#10b981';
    if (percentage >= 70) return '#3b82f6';
    if (percentage >= 50) return '#f59e0b';
    return '#ef4444';
  };

  const color = getColor();

  return (
    <div style={{ flex: 1, minWidth: '100px' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '8px' 
      }}>
        <span style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: '500' }}>{label}</span>
        <span style={{ color: '#0f172a', fontWeight: '700', fontSize: '0.95rem' }}>
          {value}{max === 100 ? '%' : ''}
        </span>
      </div>
      <div style={{ 
        height: '6px', 
        background: '#e2e8f0', 
        borderRadius: '3px', 
        overflow: 'hidden' 
      }}>
        <div 
          style={{ 
            height: '100%', 
            background: color,
            borderRadius: '3px',
            transition: 'width 0.5s ease',
            width: `${percentage}%`
          }}
        />
      </div>
    </div>
  );
};

const OperationalMetrics = ({ metrics }) => {
  if (!metrics) {
    return (
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        padding: '24px',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', color: '#0f172a', fontSize: '1.1rem', fontWeight: '600' }}>
          Operational Metrics
        </h3>
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>Loading...</div>
      </div>
    );
  }

  const { operations, capacity } = metrics;

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
    }}>
      <h3 style={{ margin: '0 0 20px 0', color: '#0f172a', fontSize: '1.1rem', fontWeight: '600' }}>
        Operational Metrics
      </h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <MetricGauge label="Crane Efficiency" value={78} />
        <MetricGauge label="Correct Tier %" value={operations?.correctTierPct || 100} />
        <MetricGauge label="Grid Utilization" value={operations?.utilizationPct || 0} />
      </div>

      <div style={{ 
        marginTop: '20px', 
        paddingTop: '20px', 
        borderTop: '1px solid #e2e8f0' 
      }}>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '12px', fontWeight: '500' }}>
          Tier Distribution
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ 
            flex: 1, 
            background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', 
            borderRadius: '8px', 
            padding: '12px', 
            textAlign: 'center',
            border: '1px solid #bfdbfe'
          }}>
            <div style={{ color: '#1d4ed8', fontWeight: '700', fontSize: '1.25rem' }}>
              {capacity?.tierDistribution?.fast || 0}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Fast</div>
          </div>
          <div style={{ 
            flex: 1, 
            background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)', 
            borderRadius: '8px', 
            padding: '12px', 
            textAlign: 'center',
            border: '1px solid #fed7aa'
          }}>
            <div style={{ color: '#c2410c', fontWeight: '700', fontSize: '1.25rem' }}>
              {capacity?.tierDistribution?.medium || 0}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Medium</div>
          </div>
          <div style={{ 
            flex: 1, 
            background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', 
            borderRadius: '8px', 
            padding: '12px', 
            textAlign: 'center',
            border: '1px solid #fecaca'
          }}>
            <div style={{ color: '#dc2626', fontWeight: '700', fontSize: '1.25rem' }}>
              {capacity?.tierDistribution?.slow || 0}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Slow</div>
          </div>
        </div>
      </div>

      {operations?.violations > 0 && (
        <div style={{ 
          marginTop: '16px', 
          padding: '12px 16px', 
          background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', 
          border: '1px solid #7dd3fc', 
          borderRadius: '8px' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1rem' }}>ℹ️</span>
            <span style={{ color: '#0369a1', fontSize: '0.85rem', fontWeight: '600' }}>
              {operations.violations} container{operations.violations > 1 ? 's' : ''} in non-optimal tier
            </span>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#0c4a6e', marginTop: '4px', marginLeft: '28px' }}>
            BoxBay direct-access eliminates reshuffling needs
          </div>
        </div>
      )}
    </div>
  );
};

export default OperationalMetrics;
