import React from 'react';

const KPICard = ({ label, value, subValue, icon, trend, color = 'blue' }) => {
  const colorStyles = {
    blue: {
      bg: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
      border: '#bfdbfe',
      text: '#1d4ed8',
      icon: '#3b82f6'
    },
    green: {
      bg: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
      border: '#a7f3d0',
      text: '#047857',
      icon: '#10b981'
    },
    yellow: {
      bg: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
      border: '#fde68a',
      text: '#b45309',
      icon: '#f59e0b'
    },
    purple: {
      bg: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
      border: '#ddd6fe',
      text: '#6d28d9',
      icon: '#8b5cf6'
    },
    cyan: {
      bg: 'linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)',
      border: '#a5f3fc',
      text: '#0e7490',
      icon: '#06b6d4'
    }
  };

  const style = colorStyles[color];

  return (
    <div style={{
      background: style.bg,
      border: `1px solid ${style.border}`,
      borderRadius: '12px',
      padding: '16px 20px',
      flex: '1',
      minWidth: '140px',
      transition: 'all 0.2s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ 
          color: '#64748b', 
          fontSize: '0.75rem', 
          fontWeight: '600', 
          textTransform: 'uppercase', 
          letterSpacing: '0.5px' 
        }}>
          {label}
        </span>
        <span style={{ fontSize: '1.25rem', opacity: 0.8 }}>{icon}</span>
      </div>
      <div style={{ 
        fontSize: '1.75rem', 
        fontWeight: '700', 
        color: style.text,
        letterSpacing: '-0.5px'
      }}>
        {value}
      </div>
      {subValue && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
          {trend !== undefined && trend !== 0 && (
            <span style={{ 
              color: trend > 0 ? '#10b981' : '#ef4444',
              fontSize: '0.75rem',
              fontWeight: '600'
            }}>
              {trend > 0 ? '↑' : '↓'}
            </span>
          )}
          <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{subValue}</span>
        </div>
      )}
    </div>
  );
};

const KPIBar = ({ metrics }) => {
  if (!metrics) {
    return (
      <div style={{
        display: 'flex',
        gap: '16px',
        padding: '20px',
        background: '#ffffff',
        borderRadius: '16px',
        marginBottom: '24px',
        border: '1px solid #e2e8f0'
      }}>
        <div style={{ color: '#94a3b8', textAlign: 'center', width: '100%', padding: '20px' }}>
          Loading metrics...
        </div>
      </div>
    );
  }

  const { energy, operations, capacity } = metrics;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '16px',
      padding: '20px',
      background: '#ffffff',
      borderRadius: '16px',
      marginBottom: '24px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
    }}>
      <KPICard
        label="Energy Today"
        value={`${energy?.todayKwh || 0} kWh`}
        subValue={energy?.savedPct ? `${energy.savedPct}% vs random` : null}
        trend={energy?.savedPct > 0 ? 1 : 0}
        icon="⚡"
        color="yellow"
      />
      <KPICard
        label="Crane Moves"
        value={operations?.movesToday || 0}
        subValue="today"
        icon="🏗️"
        color="blue"
      />
      <KPICard
        label="Throughput"
        value={`${capacity?.occupied || 0} TEU`}
        subValue={`of ${capacity?.totalSlots || 0} slots`}
        icon="📦"
        color="purple"
      />
      <KPICard
        label="Savings"
        value={`$${energy?.savedUsd || 0}`}
        subValue={`${energy?.savedKwh || 0} kWh saved`}
        trend={energy?.savedUsd > 0 ? 1 : 0}
        icon="💰"
        color="green"
      />
      <KPICard
        label="Utilization"
        value={`${operations?.utilizationPct || 0}%`}
        subValue={`${operations?.violations || 0} violations`}
        icon="📊"
        color="cyan"
      />
    </div>
  );
};

export default KPIBar;
