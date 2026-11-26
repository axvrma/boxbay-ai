import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, BookOpen, Database, GitBranch, Layers3, Server, Workflow } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { getEvidence } from '../client'
import { ComparisonHeadline, EvidenceError, Panel } from '../components/UI'
import { fmt } from '../model'
import type { Benchmark, ModelEvidence, SourceManifest } from '../model'

const stages = [
  ['Observed demand', 'Rolling-origin monthly imports and exports inform demand pressure. Vessel notices supply scenario-scale workload.'],
  ['Predictive planning', 'An appointment and dwell estimate informs pickup cost. Inbound pressure changes the opportunity cost of scarce slots.'],
  ['Feasible dispatch', 'CP-SAT chooses bounded crane, slot and start-time alternatives. The event engine commits inventory on completion.'],
  ['Paired evaluation', 'The same seeds, starting inventory and disturbances isolate policy effects. Replay links each choice to its inputs and outcomes.'],
]
const methods = [
  ['Observed and synthetic data', '192 Port of Los Angeles monthly records cover 2010–2025. The facility and container-level records are synthetic. Port volumes inform weighting and seasonality. The generator couples appointments, carrier delays, vessel delays, cargo restrictions and pickup times.'],
  ['Temporal model validation', 'Demand candidates are seasonal naive, three-year seasonal mean and XGBoost with lagged volumes and rolling means. Selection and residual calibration use 2022–2023. The 2024–2025 rolling-origin holdout uses earlier observations. Dwell uses a chronological synthetic split and a separate unseen-carrier cohort.'],
  ['Safety and feasibility', 'Size, load, reefer, hazardous compatibility, reservation, holds, availability and reachability are shared rules. Each modeled rack has one dedicated crane. A shared route lock sequences the tray legs between the interface and the under-rack handoff points. Hazard policies and geometry require operator validation.'],
  ['Scheduling and recovery', 'The solver uses optional intervals, exclusivity, transfer capacity, service priority, weighted movement energy, deadlines and queue age. Only immediate starts are committed. A failed rack crane leaves stored pickups waiting in that rack. Affected inbound work may return on its tray and be replanned to another rack.'],
  ['Energy and emissions', 'Movement includes loaded and empty lift, bounded recovery, crane traction, auxiliary draw and separate tray traction. Powered idle is counted across the fixed scenario window. The CAMX 2023 generation factor converts electricity to operational CO₂e. Ship, truck and storage construction emissions are outside this boundary.'],
  ['Trade-offs and pilot', 'Short deterministic solver budgets and candidate pruning favor interactive workloads. The model is suitable for sensitivity analysis with synthetic inputs. A pilot needs terminal movement logs, cargo policy, drive telemetry, verified crane geometry and shadow-mode validation.'],
]

export default function Engineering() {
  const [direction, setDirection] = useState<'import' | 'export'>('import')
  const [tariff, setTariff] = useState(0.18)
  const [runs, setRuns] = useState(100)
  const [cloud, setCloud] = useState(240)
  const [factor, setFactor] = useState(1)
  const models = useQuery({ queryKey: ['models'], queryFn: () => getEvidence<ModelEvidence>('models') })
  const results = useQuery({ queryKey: ['benchmarks'], queryFn: () => getEvidence<Benchmark>('benchmarks') })
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => getEvidence<SourceManifest>('sources') })
  const score = models.data?.demand[direction]
  const impact = results.data?.summaries.filter((s) =>
    s.scenario === 'surge' && s.baseline === 'reactive' && s.policy === 'predictive') ?? []
  const energy = impact.find((s) => s.metric === 'kwh')
  const emissions = impact.find((s) => s.metric === 'kg_co2e')
  const service = impact.find((s) => s.metric === 'on_time_pct')
  const waiting = impact.find((s) => s.metric === 'pickup_wait_s')
  const backlog = impact.find((s) => s.metric === 'backlog')
  const adverse = results.data?.summaries.filter((s) => s.baseline === 'reactive' && s.policy === 'predictive'
    && s.negative_pairs > 0 && ['pickup_wait_s', 'on_time_pct', 'kwh', 'backlog'].includes(s.metric))
    .sort((a, b) => b.negative_pairs - a.negative_pairs).slice(0, 5) ?? []

  const sensitivity = energy ? [.5, .75, 1, 1.25, 1.5, 1.75, 2].map((scale) => ({
    scale, usd: -energy.delta * scale * tariff * runs - cloud,
  })) : []

  return <>
    <div className="page-intro"><div><div className="eyebrow"><BookOpen size={15}/> ENGINEERING CASE STUDY</div>
      <h1>Predictive storage and scheduling</h1>
      <p>How demand signals change crane and slot decisions, and how those changes affect service and energy.</p></div>
      <Link className="button primary" to="/benchmarks"><FlaskIcon/> Explore benchmarks <ArrowUpRight size={15}/></Link>
    </div>
    <div className="case-hero">
      <div><h2>Can earlier decisions improve pickup readiness?</h2>
        <p>Every container in a high-bay system is individually accessible. The remaining opportunity is in selecting storage positions, coordinating crane work, and protecting pickup commitments when equipment or demand changes.</p>
        <Link to="/?scenario=surge" className="case-link">Replay the demand surge <ArrowRight size={16}/></Link>
      </div>
      <div className="hero-results">
        <span>DEMAND SURGE · PREDICTIVE VS REACTIVE</span>
        {service && <div><strong>{service.delta > 0 ? '+' : ''}{fmt(service.delta, 1)} pp</strong><span>On-time pickup delta</span></div>}
        {waiting && <div><strong>{waiting.delta > 0 ? '+' : ''}{fmt(waiting.delta, 1)} s</strong><span>Mean pickup wait delta</span></div>}
        {energy && <div><strong>{energy.delta > 0 ? '+' : ''}{fmt(energy.delta, 1)} kWh</strong><span>Electrical energy delta</span></div>}
        <small>{service?.pairs ?? '—'} matched seed pairs · simulated</small>
      </div>
    </div>
    {[models.error, results.error, sources.error].filter(Boolean).map((error, i) => <EvidenceError key={i} error={error}/>)}
    <Panel title="Operations workflow" subtitle="From published historical signals to reproducible decisions">
      <div className="stage-grid">{stages.map(([title, description]) => <article key={title}><Workflow size={20}/><h3>{title}</h3><p>{description}</p></article>)}</div>
    </Panel>
    <Panel title="Architecture and deployment" subtitle="The new service owns state transitions, and the browser projects the event log">
      <div className="architecture">
        <div><h3>Legacy prototype</h3><span><Layers3 size={16}/> React Create React App / Unity</span><ArrowRight size={14}/>
          <span><Server size={16}/> Express + Socket.IO</span><ArrowRight size={14}/><span><Database size={16}/> SQLite + in-memory grid</span>
          <p>Separate Python dwell server, local processes, multiple state owners and independent energy calculations.</p></div>
        <div><h3>BOXBAY AI 2.0</h3><span><Layers3 size={16}/> Vite + Three.js / Netlify</span><ArrowRight size={14}/>
          <span><Server size={16}/> FastAPI / Railway</span><ArrowRight size={14}/><span><Database size={16}/> Neon or SQLite + recorded artifacts</span>
          <p>Local training, generated contracts and GitHub Actions. The static frontend can present recorded evidence during a cold start.</p></div>
      </div>
    </Panel>
    <div className="evidence-grid equal">
      <Panel title="Observed port volumes" subtitle="Port of Los Angeles · loaded TEU by month">
        <div className="chart"><ResponsiveContainer><LineChart data={models.data?.historical ?? []}>
          <CartesianGrid vertical={false} stroke="#e3e9eb"/><XAxis dataKey="month" minTickGap={46}/>
          <YAxis width={56} tickFormatter={(v) => `${v / 1000}k`}/><Tooltip/><Legend/>
          <Line dataKey="loaded_import_teu" name="Loaded imports" stroke="#128a7b" strokeWidth={2} dot={false} isAnimationActive={false}/>
          <Line dataKey="loaded_export_teu" name="Loaded exports" stroke="#61779b" strokeWidth={2} dot={false} isAnimationActive={false}/>
        </LineChart></ResponsiveContainer></div>
      </Panel>
      <Panel title="Forecast holdout" subtitle="One-month-ahead validation · 2024–2025"
        action={<select aria-label="Forecast direction" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}><option value="import">Imports</option><option value="export">Exports</option></select>}>
        <div className="chart"><ResponsiveContainer><LineChart data={score?.holdout ?? []}>
          <CartesianGrid vertical={false} stroke="#e3e9eb"/><XAxis dataKey="month" minTickGap={36}/>
          <YAxis width={57} tickFormatter={(v) => `${Math.round(v / 1000)}k`}/><Tooltip/><Legend/>
          <Line dataKey="observed" name="Observed" stroke="#162638" strokeWidth={2} dot={false} isAnimationActive={false}/>
          <Line dataKey="prediction" name="Prediction" stroke="#128a7b" strokeWidth={2} dot={false} isAnimationActive={false}/>
          <Line dataKey="low" name="Interval lower" stroke="#92a7ac" strokeDasharray="4 4" dot={false} isAnimationActive={false}/>
          <Line dataKey="high" name="Interval upper" stroke="#92a7ac" strokeDasharray="4 4" dot={false} isAnimationActive={false}/>
        </LineChart></ResponsiveContainer></div>
        {score && <p className="chart-note">{score.selected.replaceAll('_',' ')} · MAE {fmt(score.selected_test.mae)} TEU · WAPE {fmt(score.selected_test.wape_pct, 1)}% · Interval coverage {fmt(score.selected_test.coverage_pct ?? 0, 1)}%</p>}
      </Panel>
      <Panel title="Forecast residuals" subtitle="Prediction minus observed volume · TEU">
        <div className="chart medium"><ResponsiveContainer><LineChart data={score?.holdout ?? []}>
          <XAxis dataKey="month" minTickGap={36}/><YAxis width={57} tickFormatter={(v) => `${Math.round(v / 1000)}k`}/><Tooltip/>
          <ReferenceLine y={0} stroke="#67748a"/><Line dataKey="error" name="Forecast error" stroke="#b3794e" dot={false} isAnimationActive={false}/>
        </LineChart></ResponsiveContainer></div>
        {score && <p className="chart-note">RMSE {fmt(score.selected_test.rmse)} TEU · Bias {fmt(score.selected_test.bias)} TEU · Peak MAE {fmt(score.selected_test.peak_mae)} TEU</p>}
      </Panel>
      <Panel title="Dwell calibration" subtitle="Synthetic holdout · observed vs estimated dwell days">
        <div className="chart medium"><ResponsiveContainer><ScatterChart>
          <XAxis type="number" dataKey="actual" name="Realized" unit=" d"/><YAxis type="number" dataKey="prediction" name="Estimated" unit=" d"/><Tooltip/>
          <Scatter data={models.data?.dwell.holdout ?? []} name="Synthetic records" fill="#128a7b" fillOpacity={.57} isAnimationActive={false}/>
        </ScatterChart></ResponsiveContainer></div>
        {models.data && <p className="chart-note">MAE {fmt(models.data.dwell.test.mae, 2)} d · baseline {fmt(models.data.dwell.baseline.mae, 2)} d · unseen carrier {fmt(models.data.dwell.unseen_carrier.mae, 2)} d · interval coverage {fmt(models.data.dwell.test.coverage_pct ?? 0, 1)}%</p>}
      </Panel>
    </div>
    <div className="evidence-grid equal">
      <Panel title="Adverse outcomes" subtitle="Scenarios and metrics where prediction hurt at least one paired result">
        <div className="stat-list">
          {adverse.map((s) => <p key={`${s.scenario}-${s.metric}`}><strong>{s.scenario.replaceAll('-', ' ')}</strong> · {s.metric.replaceAll('_', ' ')} · {s.negative_pairs}/{s.pairs} adverse pairs</p>)}
          {backlog && <p>Surge ending backlog delta {fmt(backlog.delta, 2)} tasks.</p>}
          <p className="muted">Seed-pair intervals describe simulated variability. Energy totals should be interpreted alongside moves completed and ending backlog.</p>
          <Link className="button" to="/benchmarks">Inspect paired outcomes <ArrowUpRight size={15}/></Link>
        </div>
      </Panel>
      <Panel title="Financial and emissions sensitivity" subtitle="Illustrative assumptions applied to the matched demand-surge result">
        <div className="stat-list">
          <div className="form-row sensitivity">
            <label>Electricity USD/kWh<input min="0" type="number" step=".01" value={tariff} onChange={(e) => setTariff(Math.max(0, Number(e.target.value)))}/></label>
            <label>Equivalent runs/year<input min="0" type="number" step="1" value={runs} onChange={(e) => setRuns(Math.max(0, Number(e.target.value)))}/></label>
            <label>Cloud USD/year<input min="0" type="number" step="1" value={cloud} onChange={(e) => setCloud(Math.max(0, Number(e.target.value)))}/></label>
            <label>Energy multiplier<input min=".5" max="2" type="number" step=".05" value={factor} onChange={(e) => setFactor(Math.min(2, Math.max(.5, Number(e.target.value))))}/></label>
          </div>
          {energy && <ComparisonHeadline title={`USD ${fmt(-energy.delta * factor * tariff * runs - cloud, 2)} per year`}
            detail={`Illustrative electricity cost difference less cloud cost. Projected avoided emissions ${fmt(-(emissions?.delta ?? 0) * factor * runs, 2)} kg CO₂e.`}/>}
          <div className="chart medium"><ResponsiveContainer><LineChart data={sensitivity}>
            <XAxis type="number" dataKey="scale" domain={[.5, 2]} tickFormatter={(x) => `${x}×`}/><YAxis width={49}/><Tooltip/>
            <ReferenceLine x={factor} stroke="#718396" strokeDasharray="3 3"/>
            <Line type="linear" dataKey="usd" name="Illustrative USD per year" stroke="#128a7b" isAnimationActive={false}/>
          </LineChart></ResponsiveContainer></div>
          <p className="muted">This projection assumes the same measured kWh delta for each equivalent run. Labor, throughput revenue and capital benefits are excluded.</p>
        </div>
      </Panel>
    </div>
    <Panel title="Method and validation boundaries" subtitle="Open each section to review model inputs, constraints and assumptions">
      <div className="method-list">{methods.map(([title, desc]) => <details key={title}><summary>{title}</summary><p>{desc}</p></details>)}</div>
    </Panel>
    <Panel title="Sources and reproducibility" subtitle={models.data?.dataset_version ?? 'Versioned training and benchmark artifacts'}>
      <div className="source-list">{sources.data?.sources.map((source) => <article key={source.id}>
        <h3><a href={source.url} target="_blank" rel="noreferrer">{source.name} <ArrowUpRight size={14}/></a></h3>
        <p>{source.publisher} · {source.coverage}</p><p>{source.limitations}</p>
      </article>)}
      <article><h3>Reproduce locally</h3><p><code>make train</code> exports model evidence. <code>make benchmark</code> regenerates matched results and replays.</p>
        <p className="mono">Training seed {models.data?.seed} · model {models.data?.version}</p></article></div>
    </Panel>
  </>
}

function FlaskIcon() { return <GitBranch size={16}/> }
