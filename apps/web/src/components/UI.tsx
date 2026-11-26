import type { ReactNode } from 'react'
import { Activity, Bolt, Boxes, Clock3, Database, GitCompareArrows, Leaf, ShieldCheck } from 'lucide-react'
import { fmt } from '../model'
import type { Run } from '../model'
import type { Frame } from '../replay'

export function Panel({ title, subtitle, action, children, className = '' }: {
  title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string
}) {
  return <section className={`panel ${className}`}>
    <div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}
  </section>
}

export function EvidenceError({ error }: {error: unknown}) {
  return <p className="notice error" role="alert">{error instanceof Error ? error.message : String(error)}</p>
}

export function Empty({ children }: {children: ReactNode}) {
  return <div className="empty"><Database size={19} /><p>{children}</p></div>
}

export function MetricStrip({ run, frame, finalized }: {run: Run; frame: Frame; finalized: boolean}) {
  const forecast = frame.forecast?.data
  const kpis = [
    { label: 'Storage occupancy', value: `${fmt(100 * frame.occupancy.size / run.slots.length, 1)}%`, secondary: `${frame.occupancy.size} of ${run.slots.length} positions`, Icon: Boxes },
    { label: 'Completed moves', value: fmt(frame.moves), secondary: `${frame.pickups} completed pickups`, Icon: Activity },
    { label: 'Service level', value: finalized ? `${fmt(run.metrics.on_time_pct, 1)}%` : fmt(frame.late), secondary: finalized ? 'On-time pickups' : 'Pickup SLA breaches', Icon: ShieldCheck },
    { label: 'Electrical energy', value: `${fmt(frame.energy, 1)} kWh`, secondary: finalized ? (run.metrics.tray_kwh ? `${fmt(run.metrics.tray_kwh, 1)} kWh tray · total includes idle` : 'Motion and powered idle') : 'Completed and interrupted movement legs', Icon: Bolt },
    { label: 'Operational CO₂e', value: `${fmt(frame.energy * (run.scenario.facility.grid_kg_per_kwh ?? 0), 2)} kg`, secondary: 'EPA eGRID CAMX · 2023', Icon: Leaf },
    { label: 'Inbound outlook', value: forecast ? fmt(Number(forecast.inbound_requests)) : '—', secondary: forecast ? `${fmt(Number(forecast.low))}–${fmt(Number(forecast.high))} estimated · ${fmt(Number(forecast.horizon_s) / 60)} min` : 'Forecast pending', Icon: Clock3 },
  ]
  return <div className="metrics">{kpis.map(({ label, value, secondary, Icon }) => <div className="metric" key={label}>
    <div className="metric-label"><Icon size={16}/>{label}</div><strong>{value}</strong><span>{secondary}</span>
  </div>)}</div>
}

export function ComparisonHeadline({ title, detail }: {title: string; detail: string}) {
  return <div className="comparison-headline"><GitCompareArrows size={20}/><div><strong>{title}</strong><p>{detail}</p></div></div>
}
