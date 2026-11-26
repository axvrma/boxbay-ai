import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowDownToLine, Box, CirclePlay, Clock3, MapPin, Pause, Play, RotateCcw, Settings2, SkipBack, SkipForward, SlidersHorizontal, Zap } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, cancelJob, downloadJson, getEvidence, useJob, useJobState } from '../client'
import { Dialog, Topology } from '../components/Controls'
import DecisionStory from '../components/DecisionStory'
import { guidedMoments, initialCursor, resolveCursor } from '../decisionReplay'
import type { Cursor } from '../decisionReplay'
import { Empty, EvidenceError, MetricStrip, Panel } from '../components/UI'
import { clock, fmt, labels, titles } from '../model'
import type { Catalog, Facility, Intervention, Policy, Run, RunInput, ScenarioId, Slot } from '../model'
import { buildFrame, trail } from '../replay'

const Twin = lazy(() => import('../three/Twin'))
const channels = ['Incidents', 'Equipment', 'Event log'] as const
const analytics = ['Pickup wait distribution', 'Crane utilization', 'Rack placement distribution'] as const
const fallbackCatalog: Catalog = { scenarios: [], policies: ['predictive', 'reactive', 'fifo', 'legacy'], seed: 102 }

export default function Command() {
  const [params] = useSearchParams()
  const [scenario, setScenario] = useState((params.get('scenario') ?? 'surge') as ScenarioId)
  const [policy, setPolicy] = useState((params.get('policy') ?? 'predictive') as Policy)
  const [live, setLive] = useState<Run>()
  const [preview, setPreview] = useState<Run>()
  const [lastLive, setLastLive] = useState<Run | null>()
  const [cursor, setCursor] = useState<Cursor>()
  const [playTime, setPlayTime] = useState(0)
  const playOrigin = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(30)
  const [analyticsTab, setAnalyticsTab] = useState<typeof analytics[number]>(analytics[0])
  const [tab, setTab] = useState<typeof channels[number]>('Incidents')
  const [dialog, setDialog] = useState<'topology' | 'incident' | 'override' | 'snapshot' | 'vessel'>()
  const [selection, setSelection] = useState<Slot>()
  const [equipment, setEquipment] = useState('')
  const [target, setTarget] = useState('')
  const [vessel, setVessel] = useState('')
  const [eta, setEta] = useState(0)
  const [cargoCount, setCargoCount] = useState(0)
  const [at, setAt] = useState(0)
  const [snapshotId, setSnapshotId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [workingConfig, setWorkingConfig] = useState<RunInput>()
  const [previousConfig, setPreviousConfig] = useState<RunInput>()
  const catalogQuery = useQuery({ queryKey: ['catalog'], queryFn: () => getEvidence<Catalog>('catalog') })
  const catalog = catalogQuery.data ?? fallbackCatalog
  const entry = catalog.scenarios.find((s) => s.id === scenario)
  const activePolicy = catalog.policies.includes(policy) ? policy : 'predictive'
  const recorded = useQuery({
    queryKey: ['replay', scenario, activePolicy], queryFn: () => getEvidence<Run>(`replays/${scenario}-${activePolicy}`),
    enabled: entry?.recorded === true && !live, retry: false,
  })
  const job = useJob<Run>((output) => {
    setLastLive(live ?? null); setPreviousConfig(workingConfig); setPreview(undefined); setLive(output)
    setWorkingConfig(submission.current)
    setCursor(undefined); setSelection(undefined); setPlaying(false)
  })
  const validation = useJob<Run>((output) => { setPreview(output) })
  const status = useJobState()
  const run = live ?? recorded.data
  const horizon = run?.scenario.horizon_s ?? 4800
  const moments = useMemo(() => run ? guidedMoments(run) : [], [run])
  const defaultCursor = useMemo(() => run ? initialCursor(run) : { time: 0 }, [run])
  const position = useMemo(() => playing ? { time: playTime } : cursor ?? defaultCursor, [playing, playTime, cursor, defaultCursor])
  const resolved = useMemo(() => run ? resolveCursor(run, position) : undefined, [run, position])
  const time = resolved?.time ?? 0
  const version = resolved?.version ?? 0
  const shown = resolved?.decision
  const selectedEvent = run && 'event' in position ? run.events[position.event - 1] : undefined
  const frame = useMemo(() => run ? buildFrame(run, time, version) : undefined, [run, time, version])
  const compared = useQuery({
    queryKey: ['replay', scenario, 'reactive'], queryFn: () => getEvidence<Run>(`replays/${scenario}-reactive`),
    enabled: entry?.recorded === true && !live && run?.policy === 'predictive', retry: false,
  })
  const selectedMoment = moments.find((item) => {
    if ('decision' in item.cursor && 'decision' in position) return item.cursor.decision === position.decision && item.cursor.phase === position.phase
    return 'event' in item.cursor && 'event' in position && item.cursor.event === position.event
  })
  const chart = useMemo(() => run ? trail(run) : [], [run])
  const waitingPickup = selectedEvent?.kind === 'PICKUP_WAITING_FOR_RACK_CRANE' ? selectedEvent : undefined
  const selectedSlot = waitingPickup?.slot ?? (shown ? String(shown.selected.slot) : undefined)
  const inspectedSlot = selection ?? run?.slots.find((item) => item.id === selectedSlot)
  const inspected = run?.scenario.work.find((w) =>
    w.container.id === (inspectedSlot && (frame?.occupancy.get(inspectedSlot.id) ?? frame?.reserved.get(inspectedSlot.id))))
  const distribution = useMemo(() => {
    if (!run) return []
    const bins = [[0, 59], [60, 119], [120, 239], [240, 479], [480, 959], [960, Infinity]]
    if (analyticsTab === 'Pickup wait distribution') {
      return bins.map(([low, high]) => ({
        label: high === Infinity ? `${low}+` : `${low}–${high}`,
        value: run.metrics.waits_s.filter((wait) => wait >= low && wait <= high).length,
      }))
    }
    const values = analyticsTab === 'Crane utilization' ? run.metrics.crane_utilization : run.metrics.placements
    return Object.entries(values).map(([label, value]) => ({ label, value }))
  }, [run, analyticsTab])
  const activeTasks = run?.events.filter((e) => e.version <= version && e.task && frame?.pending.has(e.task)
    && ['CONTAINER_ARRIVED', 'CONTAINER_DEPARTURE_REQUESTED'].includes(e.kind)) ?? []
  const previewRecord = preview?.decisions.find((d) => d.container === target && d.override && d.selected.slot === inspectedSlot?.id)
  const previewError = preview?.events.find((e) => e.container === target && e.kind === 'OPERATOR_OVERRIDE_REJECTED')
  const config: RunInput = workingConfig ?? { scenario, seed: catalog.seed, policy: activePolicy, interventions: [], vessel_revisions: [] }
  const submission = useRef<RunInput | undefined>(undefined)
  const selectedDestination = inspectedSlot?.id
  const vessels = Array.from(new Map((run?.scenario.vessels ?? []).map((v) => [v.id, v])).values())
  const unreleased = (id: string, atSeconds: number) => run?.scenario.work.filter(
    (w) => w.container.vessel === id && w.release_s >= atSeconds,
  ).length ?? 0

  function editVessel(id: string, time: number) {
    const item = vessels.find((v) => v.id === id)
    const notice = Math.max(time, (item?.notice_s ?? 0) + 1)
    setVessel(id); setAt(notice); setEta(Math.max(notice, item?.updated_s ?? 0))
    setCargoCount(unreleased(id, notice))
  }
  function jump(next: Cursor) {
    setPlaying(false); setCursor(next); setSelection(undefined)
  }

  function inspect(slotId: string, atDecision?: string) {
    const slot = run?.slots.find((item) => item.id === slotId)
    if (slot) {
      if (atDecision) jump({ decision: atDecision, phase: 'decision' })
      else if (playing) jump({ time })
      setSelection(slot)
    }
  }

  function step(direction: -1 | 1) {
    const previous = run?.events[version - 1]
    const nextVersion = direction === -1 && previous && previous.t < time ? version : version + direction
    if (nextVersion <= 0) jump({ event: 0 })
    else if (run && nextVersion <= run.events.length) jump({ event: nextVersion })
  }

  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    let elapsed = playOrigin.current
    let animation = 0
    const tick = (stamp: number) => {
      if (stamp - previous > 46) {
        elapsed = Math.min(horizon, elapsed + Math.min((stamp - previous) / 1000, .15) * speed)
        playOrigin.current = elapsed
        setPlayTime(elapsed)
        previous = stamp
        if (elapsed >= horizon) {
          setCursor({ time: horizon }); setPlaying(false)
          return
        }
      }
      animation = requestAnimationFrame(tick)
    }
    animation = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animation)
  }, [playing, speed, horizon])

  function resetSelection() {
    setLive(undefined); setWorkingConfig(undefined); setPreviousConfig(undefined); setLastLive(undefined)
    setSelection(undefined); setCursor(undefined); setPlaying(false)
    job.reset()
  }

  function simulate(input: RunInput = config) {
    submission.current = input
    if (playing) jump({ time })
    setDialog(undefined)
    job.mutate({ path: '/runs', payload: input, result: '/runs' })
  }

  function topologyChange(facility: Facility) {
    const removesOccupied = run?.slots.some((slot) => {
      if (!frame?.occupancy.has(slot.id)) return false
      const rack = facility.racks.find((candidate) => candidate.id === slot.rack)
      return !rack || slot.bay > rack.bays || slot.level > rack.levels || slot.position > rack.positions
    })
    if (removesOccupied) return 'The change removes occupied storage. Choose an empty rack or clear the affected inventory first.'
    const removesMoving = Object.values(frame?.cranes ?? {}).find((crane) =>
      crane.motion && !facility.cranes.some((candidate) => candidate.id === crane.id),
    )
    if (removesMoving) return `Suspend ${removesMoving.id} before removing it from this view.`
    simulate({ ...config, facility, snapshot: null, interventions: [], vessel_revisions: [] })
  }

  function intervention(action: Intervention) {
    simulate({ ...config, interventions: [...(config.interventions ?? []), action] })
  }

  async function save() {
    if (!run) return
    setFeedback('')
    try {
      const id = snapshotId || `snapshot-${crypto.randomUUID().slice(0, 12)}`
      await api(`/scenarios?snapshot_id=${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ ...run.scenario, version: 1 }) })
      setSnapshotId(id); setFeedback(`Saved snapshot ${id}`)
    } catch (error) { setFeedback(String(error)) }
  }

  return <>
    <div className="page-intro">
      <div><h1>AI Decision Replay</h1><p>See which slot the AI chose, what it knew at the time, and how the move played out.</p></div>
      <div className="intro-actions">
        <Link className="button primary" to="/demo"><CirclePlay size={16}/> Try the shift demo</Link>
        <span className={`badge ${live ? 'teal' : ''}`}><span className="signal"/>{live ? 'Live engine result' : 'Recorded replay'}</span>

      </div>
    </div>
    <div className="scenario-bar">
      <label><span>Scenario</span><select aria-label="Scenario" value={scenario} disabled={!!status.status}
        onChange={(e) => { setScenario(e.target.value as ScenarioId); resetSelection() }}>
        {catalog.scenarios.length === 0 && <option value={scenario}>Loading scenarios…</option>}
        {catalog.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label><span>Scheduling policy</span><select aria-label="Scheduling policy" value={activePolicy} disabled={!!status.status}
        onChange={(e) => { setPolicy(e.target.value as Policy); resetSelection() }}>
        {catalog.policies.map((p) => <option key={p} value={p}>{labels[p]}</option>)}</select></label>
      <div className="scenario-desc"><Box size={16}/>{entry?.description ?? 'Select a scenario to inspect its facility and event trace.'}</div>
      {status.id && <button className="button" onClick={() => { void cancelJob(status.id).catch((error) => setFeedback(String(error))) }}>Cancel</button>}
      <button className="button" disabled={!entry || !!status.status} onClick={() => simulate()}><Zap size={15}/>{status.status || 'Run simulation'}</button>
    </div>
    {catalogQuery.isError && <EvidenceError error={catalogQuery.error}/>}
    {job.error && <EvidenceError error={job.error}/>}
    {feedback && !dialog && <p role="status" className="notice">{feedback}</p>}
    {recorded.error && !live && <EvidenceError error={recorded.error}/>}
    {!run || !frame ? <Panel title="Facility replay"><Empty>{recorded.isLoading ? 'Loading recorded scenario…' : 'Run this scenario to generate its event trace.'}</Empty></Panel>
      : <>
        {moments.length > 0 && <div className="guided-moments" aria-label="Scenario highlights">
          <strong>Start here</strong>
          {moments.map((moment) => <button type="button" key={moment.label} className="button"
            aria-pressed={selectedMoment?.label === moment.label}
            onClick={() => jump(moment.cursor)}>{moment.label}</button>)}
        </div>}
        <div className="decision-workspace">
          <DecisionStory run={run} decision={shown} cursor={position} time={time} version={version} compare={compared.data}
            jump={jump} inspect={inspect}/>
          <Panel className="facility-panel decision-facility" title="Facility at this moment"
            subtitle={selectedMoment?.label ?? (selectedEvent ? titles[selectedEvent.kind] ?? selectedEvent.kind : run.scenario.facility.name)}
            action={<time className="panel-meta">{clock(time)}</time>}>
            <Suspense fallback={<div className="twin"><Empty>Loading the digital twin…</Empty></div>}>
              <Twin key={run.id} run={run} frame={frame} time={time} select={(slot) => inspect(slot.id)}
                selection={inspectedSlot?.id} decisionSlot={selectedSlot} decisionCrane={waitingPickup?.crane ?? (shown ? String(shown.selected.crane) : undefined)}
                decisionId={shown?.id}/>
            </Suspense>
            <div className="timeline">
              <button className="icon-button play" aria-label={playing && time < horizon ? 'Pause' : 'Play'} onClick={() => {
                if (playing && time < horizon) jump({ time })
                else {
                  playOrigin.current = time >= horizon ? 0 : time
                  setPlayTime(playOrigin.current); setPlaying(true); setSelection(undefined)
                }
              }}>{playing && time < horizon ? <Pause size={18}/> : <Play size={17}/>}</button>
              <button className="icon-button" aria-label="Step to previous event" title="Step to previous event"
                disabled={!version} onClick={() => step(-1)}><SkipBack size={17}/></button>
              <button className="icon-button" aria-label="Step to next event" title="Step to next event"
                disabled={version >= run.events.length} onClick={() => step(1)}><SkipForward size={17}/></button>
              <button className="icon-button timeline-reset" aria-label="Reset playback" title="Reset playback"
                onClick={() => jump({ event: 0 })}><RotateCcw size={16}/></button>
              <input aria-label="Simulation time" aria-valuetext={clock(time)} type="range" min="0" max={horizon} value={Math.floor(time)}
                onChange={(e) => jump({ time: Number(e.target.value) })}/>
              <select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {[1, 10, 30, 60, 120].map((value) => <option key={value} value={value}>{value}×</option>)}</select>
            </div>
            <div className="facility-state">
              <span><Clock3 size={14}/>{selectedEvent ? (titles[selectedEvent.kind] ?? selectedEvent.kind.replaceAll('_', ' '))
                : 'decision' in position ? 'Assignment replay' : version === 0 ? 'Before the first event' : 'Simulation timeline'}</span>
              <span>Event {fmt(version)} / {fmt(run.events.length)}</span>
            </div>
            {selectedEvent?.kind === 'DEMAND_FORECAST_UPDATED' && <div className="inspected-slot">
              <span><strong>{fmt(Number(selectedEvent.data?.inbound_requests))} inbound requests expected</strong>
                {' · '}{fmt(Number(selectedEvent.data?.notice_count))} announced · next {fmt(Number(selectedEvent.data?.horizon_s) / 60)} min</span>
            </div>}
            {selectedEvent?.kind === 'PICKUP_WAITING_FOR_RACK_CRANE' && <div className="inspected-slot">
              <span><strong>{selectedEvent.container} stays in {selectedEvent.slot}</strong> · waiting for {selectedEvent.crane}</span>
            </div>}
            {Object.values(frame.trays).some((tray) => tray.path) && <div className="inspected-slot">
              <span>{Object.values(frame.trays).filter((tray) => tray.path).map((tray) =>
                `${tray.id} ${tray.container ? `carrying ${tray.container}` : 'moving empty'}`).join(' · ')}</span>
            </div>}
            {inspectedSlot && <div className="inspected-slot">
              <MapPin size={16}/><span><strong>{inspectedSlot.id}</strong> · {frame.blocked.has(inspectedSlot.id) ? 'Blocked' :
                frame.occupancy.has(inspectedSlot.id) ? 'Occupied' : frame.reserved.has(inspectedSlot.id) ? 'Reserved' : 'Available'}
                {inspected ? ` · ${inspected.container.id} · ${inspected.container.size_ft} ft` : ''}
                {' · '}{inspectedSlot.reefer ? 'Powered slot' : 'Standard slot'}</span>
              {selection && selection.id !== selectedSlot && selectedSlot && <button className="link-button" onClick={() => setSelection(undefined)}>Back to decision slot</button>}
            </div>}
          </Panel>
        </div>
        <details className="operations-disclosure panel" key={run.id}>
          <summary>Operations, interventions and run metrics</summary>
          <div className="operations-body">
          <MetricStrip run={run} frame={frame} finalized={version === run.events.length}/>
          <div className="facility-footer operations-actions">
            <div>
              <button className="button" onClick={() => setDialog('topology')} disabled={job.isPending}><Settings2 size={16}/> Topology</button>
              <button className="button" title="Download event trace" onClick={() => downloadJson(run.id, run)}><ArrowDownToLine size={15}/> Export</button>
              <button className="button" onClick={() => { setFeedback(''); setDialog('snapshot') }}>Snapshots</button>
              {lastLive !== undefined && <button className="button" onClick={() => {
                setLive(lastLive ?? undefined); setWorkingConfig(previousConfig); setLastLive(undefined)
                setCursor(undefined); setSelection(undefined); setPlaying(false)
              }}>Undo run</button>}
            </div>
          </div>
          <div className="command-grid bottom-grid">
            <Panel className="activity-panel" title="Operations activity"
            action={<button className="icon-button" title="Simulate intervention" aria-label="Simulate intervention"
              disabled={job.isPending} onClick={() => { setEquipment(run.scenario.facility.cranes[0].id); setAt(Math.floor(time)); setDialog('incident') }}><AlertTriangle size={17}/></button>}>
            <div className="tabs" aria-label="Activity view">{channels.map((channel) =>
              <button key={channel} aria-pressed={tab === channel} onClick={() => setTab(channel)}>{channel}</button>)}</div>
            {tab === 'Incidents' && <div className="activity-list">
              {vessels.length > 0 && <button className="button" disabled={!!status.status} onClick={() => {
                editVessel(vessels[0].id, Math.floor(time)); setDialog('vessel')
              }}>Update vessel workload</button>}
              {!frame.interventions.length && <Empty>No incidents or vessel updates at this point.</Empty>}
              {frame.interventions.slice(-20).reverse().map((e) => <button key={e.id} className="activity-item" onClick={() => jump({ event: e.version })}>
                <span className="activity-icon"><AlertTriangle size={14}/></span><span><strong>{titles[e.kind] ?? e.kind}</strong>
                  <small>{e.crane ?? e.container ?? String(e.data?.id ?? '')}</small></span><time>{clock(e.t)}</time></button>)}
            </div>}
            {tab === 'Equipment' && <div className="activity-list">
              {Object.values(frame.cranes).map((c) => <button key={c.id} className="activity-item"
                onClick={() => { setEquipment(c.id); setAt(Math.floor(time)); setDialog('incident') }}>
                <span className="activity-icon"><SlidersHorizontal size={15}/></span><span><strong>{c.id} · {run.scenario.facility.cranes.find((crane) => crane.id === c.id)?.racks[0]}</strong>
                  <small>{c.motion?.event.task ?? 'No executing task'}</small></span><span className={`badge ${c.state === 'failed' ? 'red' : 'teal'}`}>{c.state}</span></button>)}
              <p className="muted activity-note">{frame.pending.size} released tasks in execution or awaiting assignment.</p>
              {activeTasks.slice(0, 5).map((e) => <div className="queue-item" key={e.id}>
                <span>{e.kind === 'CONTAINER_ARRIVED' ? 'Store' : 'Retrieve'} {e.container}</span>
                <time>Due {clock(Number(e.data?.deadline_s))}</time>
              </div>)}
            </div>}
            {tab === 'Event log' && <div className="event-jump">
              <label>Jump to an event<select aria-label="Jump to an event" value={version} onChange={(event) => jump({ event: Number(event.target.value) })}>
                <option value={0}>Before the first event</option>
                {run.events.map((event) => <option key={event.id} value={event.version}>
                  {clock(event.t)} · {titles[event.kind] ?? event.kind.replaceAll('_', ' ')}{event.container ? ` · ${event.container}` : ''}
                </option>)}
              </select></label>
            </div>}
          </Panel>
          <Panel title="Occupancy and backlog" subtitle="Full scenario trace · simulated">
            <div className="chart medium"><ResponsiveContainer><AreaChart data={chart} margin={{ left: 3, right: 12, top: 10 }}>
              <XAxis dataKey="t" type="number" domain={[0, horizon]} tickFormatter={(n) => `${Math.round(n / 60)}m`}/><YAxis width={33}/>
              <Tooltip labelFormatter={(n) => clock(Number(n))}/><Area type="stepAfter" dataKey="occupancy" name="Occupied positions" stroke="#1a907e" fill="#c2ece1" isAnimationActive={false}/>
              <Area type="stepAfter" dataKey="backlog" name="Pending tasks" stroke="#d47c49" fill="#f4dfd0" isAnimationActive={false}/>
            </AreaChart></ResponsiveContainer></div>
          </Panel>
        </div>
          <Panel title="Slot controls" subtitle="Select a slot in the facility to inspect or test it.">
            {inspectedSlot ? <div className="slot-detail">
              <strong className="mono">{inspectedSlot.id}</strong><p>{frame.blocked.has(inspectedSlot.id) ? 'Blocked' : frame.occupancy.has(inspectedSlot.id) ? 'Occupied' : frame.reserved.has(inspectedSlot.id) ? 'Reserved' : 'Available'} · {inspectedSlot.reefer ? 'Reefer enabled' : 'Dry compatible'}</p>
              {inspected && <p>{inspected.container.id} · {inspected.container.size_ft} ft · {fmt(inspected.container.gross_kg)} kg · carrier {inspected.container.carrier}</p>}
              <div className="form-row">
                <button className="button" disabled={!!status.status} onClick={() => intervention({
                  kind: frame.blocked.has(inspectedSlot.id) ? 'unblock' : 'block', at_s: Math.floor(time), target: inspectedSlot.id,
                })}>{frame.blocked.has(inspectedSlot.id) ? 'Unblock' : 'Block slot'}</button>
                <button className="button" disabled={!!status.status} onClick={() => {
                  setPreview(undefined); validation.reset(); setTarget(run.scenario.work.find((w) => !w.initial_slot)?.container.id ?? '')
                  setAt(0); setDialog('override')
                }}>Validate override</button>
              </div>
            </div> : <Empty>Slot coordinates, compatibility and container information appear here.</Empty>}
          </Panel>
        <Panel title={analyticsTab}
          subtitle={analyticsTab === 'Pickup wait distribution' ? 'Completed pickup requests by wait window in seconds · full run'
            : analyticsTab === 'Crane utilization' ? 'Busy time as a share of equipment availability · full run'
              : 'Completed storage requests by rack · full run'}
          action={<select aria-label="Operational chart" value={analyticsTab}
            onChange={(e) => setAnalyticsTab(e.target.value as typeof analyticsTab)}>
            {analytics.map((name) => <option key={name}>{name}</option>)}</select>}>
          <div className="chart medium"><ResponsiveContainer><BarChart data={distribution} margin={{top: 9, right: 12}}>
            <CartesianGrid vertical={false} stroke="#e3e9eb"/><XAxis dataKey="label"/>
            <YAxis width={42} unit={analyticsTab === 'Crane utilization' ? '%' : undefined}/><Tooltip/>
            <Bar dataKey="value" name={analyticsTab === 'Crane utilization' ? 'Utilization %' : 'Completed requests'}
              fill="#23877a" radius={[4, 4, 0, 0]} isAnimationActive={false}/>
          </BarChart></ResponsiveContainer></div>
        </Panel>
        </div>
        </details>
      </>}
    {dialog && run && <Dialog title={{ topology: 'Facility topology', incident: 'Crane intervention',
      override: 'Placement override', snapshot: 'Scenario snapshots', vessel: 'Vessel workload update' }[dialog]} close={() => setDialog(undefined)}>
      {dialog === 'topology' && <Topology config={run.scenario.facility} apply={topologyChange}/>}
      {dialog === 'incident' && <><p className="muted">The engine replays the same workload with a crane event inserted at the chosen time.</p>
        <div className="form-row"><label>Crane<select value={equipment} onChange={(e) => setEquipment(e.target.value)}>
          {run.scenario.facility.cranes.map((c) => <option key={c.id}>{c.id}</option>)}</select></label>
          <label>Simulation second<input type="number" min="0" max={horizon} value={at} onChange={(e) => setAt(Number(e.target.value))}/></label></div>
        <div className="form-row"><button className="button danger" onClick={() => intervention({kind: 'failure', target: equipment, at_s: at})}>Simulate failure</button>
          <button className="button" onClick={() => intervention({kind: 'recovery', target: equipment, at_s: at})}>Simulate recovery</button></div></>}
      {dialog === 'override' && <>
        <div className="form-row"><label>Incoming container<select value={target} onChange={(e) => { setTarget(e.target.value); setPreview(undefined) }}>
          {run.scenario.work.filter((w) => !w.initial_slot).map((w) => <option key={w.container.id} value={w.container.id}>{w.container.id} · {clock(w.release_s)}</option>)}</select></label>
          <label>Destination<input value={selectedDestination ?? ''} readOnly/></label></div>
        {validation.error && <EvidenceError error={validation.error}/>}
        {previewRecord?.override && <p className="notice">Feasible. Recommendation {String((previewRecord.override.recommended as {slot: string}).slot)}
          {' '}→ selected {selectedDestination}. Movement Δ {fmt(Number(previewRecord.override.delta_seconds))} s, energy Δ {fmt(Number(previewRecord.override.delta_kwh), 2)} kWh.
          {' '}Projected deadline slack {String(previewRecord.selected.slack_s)} s.</p>}
        {preview && !previewRecord && <p className="notice error">{String(previewError?.data?.reason ?? 'This override could not be executed in the scenario window.')}</p>}
        <div className="form-row">
          <button className="button" disabled={!target || !selectedDestination || !!status.status} onClick={() => validation.mutate({
            path: '/optimization/validate-override',
            payload: { config, container: target, slot: selectedDestination, at_s: at },
            result: '/runs',
          })}>{status.status || 'Calculate feasibility'}</button>
          <button className="button primary" disabled={!previewRecord || !selectedDestination || !!status.status}
            onClick={() => { if (selectedDestination) intervention({kind: 'override', target, slot: selectedDestination, at_s: at}) }}>Apply and simulate</button>
        </div>
      </>}
      {dialog === 'vessel' && <>
        <p className="muted">Shift unreleased cargo to a new estimated arrival, or reduce planned cargo. Announced notices, released work and prior-run evidence are preserved.</p>
        <div className="form-row">
          <label>Vessel<select value={vessel} onChange={(e) => editVessel(e.target.value, Math.floor(time))}>
            {vessels.map((v) => <option key={v.id}>{v.id}</option>)}</select></label>
          <label>Notice second<input type="number" min="1" max={horizon} value={at} onChange={(e) => {
            const value = Number(e.target.value); setAt(value); setCargoCount(unreleased(vessel, value))
          }}/></label>
          <label>Estimated arrival second<input type="number" min="0" max={horizon} value={eta} onChange={(e) => setEta(Number(e.target.value))}/></label>
          <label>Remaining inbound<input type="number" min="0" max={unreleased(vessel, at)} value={cargoCount} onChange={(e) => setCargoCount(Number(e.target.value))}/></label>
        </div>
        <button type="button" className="button primary"
          disabled={!!status.status || !unreleased(vessel, at) || cargoCount < 0 || cargoCount > unreleased(vessel, at) || at > horizon || eta > horizon}
          onClick={() => simulate({ ...config, vessel_revisions: [
            ...(config.vessel_revisions ?? []),
            { vessel, notice_s: at, estimated_arrival_s: eta, inbound_count: cargoCount },
          ] })}>Apply vessel update</button>
      </>}
      {dialog === 'snapshot' && <>
        <p className="muted">Save or restore the facility, starting inventory, workload and scheduled interventions.</p>
        <div className="form-row"><label>Snapshot ID<input value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)} placeholder="Generated on save"/></label></div>
        <div className="form-row"><button className="button" onClick={() => void save()}>Save current scenario</button>
          <button className="button primary" disabled={!snapshotId || !!status.status} onClick={() => simulate({
            scenario, seed: catalog.seed, policy: activePolicy, snapshot: snapshotId, interventions: [], vessel_revisions: [],
          })}>Restore and simulate</button></div>
        {feedback && <p className="notice" role="status">{feedback}</p>}
      </>}
    </Dialog>}
  </>
}
