import React from 'react';

const LogEntry = ({ log }) => {
  const getIcon = (message) => {
    if (message.includes('Inbound') || message.includes('📦')) return '📦';
    if (message.includes('Retrieved') || message.includes('retrieved')) return '🚚';
    if (message.includes('Error') || message.includes('❌')) return '❌';
    if (message.includes('Connected') || message.includes('✅')) return '✅';
    if (message.includes('Housekeeping') || message.includes('🧹')) return '🧹';
    if (message.includes('JIT') || message.includes('🚨')) return '🚨';
    if (message.includes('Idle')) return '⏸️';
    return '📋';
  };

  const getColor = (message) => {
    if (message.includes('Error') || message.includes('❌')) return '#ef4444';
    if (message.includes('Connected') || message.includes('✅')) return '#10b981';
    if (message.includes('JIT') || message.includes('🚨')) return '#f59e0b';
    return '#475569';
  };

  const timestamp = log.match(/^\[([^\]]+)\]/)?.[1] || '';
  const message = log.replace(/^\[.*?\]\s*/, '').replace(/^[📦🚚❌✅🧹🚨⏸️📋]\s*/, '');

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'flex-start', 
      gap: '10px', 
      padding: '10px 0',
      borderBottom: '1px solid #f1f5f9'
    }}>
      <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>{getIcon(log)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ 
          fontSize: '0.8rem', 
          color: getColor(log),
          wordBreak: 'break-word',
          lineHeight: '1.4'
        }}>
          {message}
        </div>
        {timestamp && (
          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '2px' }}>
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
};

const LiveLog = ({ logs = [] }) => {
  return (
    <div style={{
      background: '#ffffff',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.1rem', fontWeight: '600' }}>
          Live System Log
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ 
            width: '8px', 
            height: '8px', 
            background: '#10b981', 
            borderRadius: '50%',
            animation: 'pulse 2s infinite'
          }}></span>
          <span style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '500' }}>Live</span>
        </div>
      </div>

      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        background: '#f8fafc', 
        borderRadius: '10px', 
        padding: '12px 16px',
        border: '1px solid #e2e8f0',
        maxHeight: '220px'
      }}>
        {logs.length === 0 ? (
          <div style={{ 
            color: '#94a3b8', 
            textAlign: 'center', 
            padding: '40px 20px',
            fontSize: '0.85rem'
          }}>
            Waiting for events...
          </div>
        ) : (
          logs.slice(0, 50).map((log, index) => (
            <LogEntry key={index} log={log} />
          ))
        )}
      </div>

      <div style={{ 
        marginTop: '12px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        fontSize: '0.7rem',
        color: '#94a3b8'
      }}>
        <span>{logs.length} events</span>
        <span>{new Date().toLocaleTimeString()}</span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default LiveLog;
