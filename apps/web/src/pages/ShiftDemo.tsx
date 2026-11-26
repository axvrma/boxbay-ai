import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Box, Check, ClipboardCheck, Clock3, RotateCcw, ShieldCheck, Siren, Zap } from 'lucide-react'
import { getEvidence } from '../client'
import { Empty, EvidenceError } from '../components/UI'
import { decisionTrace } from '../decisionReplay'
import { clock, fmt } from '../model'
import type { Decision, Point, Run } from '../model'
import { buildFrame, trayPosition } from '../replay'
import type { Frame } from '../replay'
import './shift-demo.css'

type Branch = 'keep' | 'stage' | 'priority'
type Step = 'ready' | 'approval' | 'stored' | 'review' | 'pickup' | 'outcome'
type Evidence = { container: string; priorityContainer: string; review_s: number; runs: Record<Branch, Run> }

function move(run: Run, action: string, container: string) {
  const decision = run.decisions.find((d) => d.action === action && d.container === container)
  if (!decision) throw new Error('A decision is missing from the recorded shift.')
  const { start, result } = decisionTrace(run, decision)
  if (!start || result?.kind !== 'HANDLING_TASK_COMPLETED') throw new Error('A move is incomplete in the recorded shift.')
  return { decision, start, result }
}

async function loadDemo() {
  const evidence = await getEvidence<Evidence>('shift-demo')
  const { runs, container, priorityContainer, review_s } = evidence
  const placement = move(runs.stage, 'store', container)
  const relocation = move(runs.stage, 'relocate', container)
  const urgent = move(runs.priority, 'pickup', priorityContainer)
  const deferred = runs.priority.events.find((e) =>
    e.t === review_s && e.kind === 'OPTIMIZATION_COMPLETED' && e.data?.status === 'NO_ACTION')
  if (!deferred) throw new Error('The priority job is missing its reshuffle review.')
  const pickups = {
    keep: move(runs.keep, 'pickup', container),
    stage: move(runs.stage, 'pickup', container),
    priority: move(runs.priority, 'pickup', container),
  }
  const cargo = runs.stage.scenario.work.find((w) => w.container.id === container)?.container
  if (!cargo) throw new Error('The inbound container is missing from the recorded shift.')
  return { ...evidence, placement, relocation, urgent, deferred, pickups, cargo }
}

type Demo = Awaited<ReturnType<typeof loadDemo>>
type Move = ReturnType<typeof move>
type Playback = { motion: Move; next: Step; label: string }

const intro = [
  ['01', 'Arrival'], ['02', 'Slot approval'], ['03', 'Idle window'], ['04', 'Pickup outcome'],
]
const stepIndex: Record<Step, number> = { ready: 0, approval: 1, stored: 1, review: 2, pickup: 2, outcome: 3 }
const slotOf = (decision: Decision) => String(decision.selected.slot)
const duration = (motion: Move) => Number(motion.result.data?.wait_s)
const isLate = (motion: Move) => motion.result.data?.late === true

function RackMap({ run, frame, time, target, container, belt, status }: {
  run: Run; frame: Frame; time: number; target?: string; container: string; belt: boolean; status: string
}) {
  const rack = run.scenario.facility.racks[0]
  const crane = Object.values(frame.cranes)[0]
  const motion = crane.motion
  const progress = motion ? Math.min(1, Math.max(0, (time - motion.event.t) / (motion.finish - motion.event.t))) : 0
  const carried = motion && progress >= .35 ? motion.event.container : undefined
  const from = motion && (carried ? motion.source : motion.origin)
  const to = motion && (carried ? motion.end : motion.source)
  const leg = carried ? (progress - .35) / .65 : progress / .35
  const cranePoint = from && to ? from.map((v, i) => v + (to[i] - v) * leg) as Point : crane.xy
  const tray = Object.values(frame.trays)[0]
  const x = (m: number) => Math.max(24, 92 + (m - rack.x - 8) * 4.35)
  const y = (m: number) => 199 - (m - 1.65) * 13
  const trayX = tray ? x(trayPosition(tray, time)[0]) : 24

  return <svg className="shift-map" role="img" aria-label={`Rack R1. ${status}${target ? ` Target: ${target}.` : ''}`}
    viewBox="0 0 620 248">
    <defs><pattern id="shift-blocked" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="7" height="7" fill="#283748"/><path d="M0 0v7" stroke="#485569" strokeWidth="2"/>
    </pattern></defs>
    {Array.from({ length: rack.bays }, (_, index) => {
      const cx = x(rack.x + 8 + index * (rack.bay_pitch_m ?? 15))
      return <g key={index}>
        <text x={cx} y="23" textAnchor="middle">BAY {String(index + 1).padStart(2, '0')}</text>
        <path d={`M${cx - 32} 34v137`} stroke="#304859"/>
      </g>
    })}
    <path d="M60 34h520v137H60z M24 199h556" fill="none" stroke="#4c6c82"/>
    <path d="M24 202h556" fill="none" stroke="#5b7488" strokeDasharray="4 5"/>
    {run.slots.map((slot) => {
      const id = frame.occupancy.get(slot.id)
      const cargo = id !== carried ? id : undefined
      const blocked = frame.blocked.has(slot.id)
      const highlighted = slot.id === target
      const tracked = cargo === container
      const cx = x(slot.xyz[0])
      const cy = y(slot.xyz[1])
      return <g key={slot.id}>
        <title>{slot.id} · {blocked ? 'Under inspection' : cargo ?? 'Empty'}{highlighted ? ' · Target slot' : ''}</title>
        <rect x={cx - 27} y={cy - 15} width="54" height="30" rx="3" vectorEffect="non-scaling-stroke"
          fill={blocked ? 'url(#shift-blocked)' : tracked ? '#f7c677' : cargo ? '#3e6579' : highlighted ? '#194d49' : '#172a3d'}
          stroke={highlighted ? '#89efd4' : tracked ? '#ffd89e' : '#36556c'} strokeWidth={highlighted ? 2 : 1}/>
        {cargo && <text x={cx} y={cy + 3.5} textAnchor="middle" className={tracked ? 'shift-box-text' : ''}>{cargo.slice(3)}</text>}
        {!cargo && highlighted && <circle cx={cx} cy={cy} r="3" fill="#9bf5dd"/>}
      </g>
    })}
    <g className="shift-crane">
      <path d={`M${x(cranePoint[0])} 40V${y(cranePoint[1])}`} stroke="#89efd4" strokeOpacity={motion ? .8 : .3}/>
      <rect x={x(cranePoint[0]) - 10} y="33" width="20" height="8" rx="2" fill="#8ce2cb"/>
    </g>
    {carried && <g transform={`translate(${x(cranePoint[0])} ${y(cranePoint[1])})`}>
      <rect x="-25" y="-10" width="50" height="20" rx="3" fill="#f7c677"/>
      <text y="4" textAnchor="middle" className="shift-box-text">{carried.slice(3)}</text>
    </g>}
    {(tray || belt) && <g transform={`translate(${trayX} 196)`}>
      <rect x="-16" y="-4" width="32" height="8" rx="2" fill="#7493a9"/>
      {(belt || tray?.container) && <>
        <rect x="-19" y="-22" width="38" height="16" rx="3" fill="#f7c677"/>
        <text y="-11" textAnchor="middle" className="shift-box-text">{(tray?.container ?? container).slice(3)}</text>
      </>}
    </g>}
    <text x="24" y="226">BELT / TRANSFER</text>
    <text x="579" y="226" textAnchor="end">RACK R1 · SIDE VIEW</text>
  </svg>
}

function ShiftComparison({ demo }: { demo: Demo }) {
  const old = demo.pickups.keep
  return <section className="shift-comparison" aria-labelledby="shift-comparison-title">
    <div className="shift-section-title"><div><h2 id="shift-comparison-title">Same pickup, two plans</h2>
      <p>Pickup has a {Number(old.result.data?.deadline_s) - (demo.cargo.appointment_s ?? 0)}-second cutoff. Energy covers the full simulated shift, including the extra move and powered idle.</p></div>
      <span className="badge">Paired simulation</span>
    </div>
    <div className="shift-options">
      {(['keep', 'stage'] as const).map((key) => {
        const pickup = demo.pickups[key]
        return <div className={key === 'stage' ? 'shift-plan preferred' : 'shift-plan'} key={key}>
          <div className="shift-plan-title"><h3>{key === 'keep' ? 'Leave in place' : 'Stage during idle time'}</h3>
            <span className={`badge ${isLate(pickup) ? 'red' : 'teal'}`}>{isLate(pickup) ? 'Misses cutoff' : 'Meets cutoff'}</span></div>
          <dl><div><dt>Pickup wait</dt><dd>{duration(pickup)} s</dd></div>
            <div><dt>Total energy</dt><dd>{fmt(demo.runs[key].metrics.kwh, 2)} kWh</dd></div>
            <div><dt>Extra move</dt><dd>{key === 'stage' ? `${duration(demo.relocation)} s` : 'None'}</dd></div></dl>
        </div>
      })}
    </div>
  </section>
}

function Session({ demo }: { demo: Demo }) {
  const { runs, placement, relocation, urgent, deferred, cargo, review_s: reviewTime } = demo
  const [step, setStep] = useState<Step>('ready')
  const [branch, setBranch] = useState<Branch>('stage')
  const [playing, setPlaying] = useState<Playback>()
  const [animationTime, setAnimationTime] = useState(0)
  const run = runs[branch]
  const pickup = demo.pickups[branch]
  const originalSlot = slotOf(placement.decision)
  const originalBay = run.slots.find((slot) => slot.id === originalSlot)?.bay
  const nearSlot = slotOf(relocation.decision)
  const pickupSlot = slotOf(pickup.decision)
  const priority = branch === 'priority'

  function play(motion: Move, next: Step, label: string, chosen: Branch = branch) {
    setBranch(chosen)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(next)
      return
    }
    setAnimationTime(motion.start.t)
    setPlaying({ motion, next, label })
  }

  useEffect(() => {
    if (!playing) return
    const { motion, next } = playing
    const startedAt = performance.now()
    const length = motion.result.t - motion.start.t
    let request: number
    const tick = (now: number) => {
      const elapsed = now - startedAt
      const playbackMs = Math.min(3300, Math.max(1400, length * 24))
      if (elapsed >= playbackMs) {
        setPlaying(undefined)
        setStep(next)
      } else {
        setAnimationTime(motion.start.t + elapsed / playbackMs * length)
        request = requestAnimationFrame(tick)
      }
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing])

  function reset() {
    setPlaying(undefined)
    setStep('ready')
    setBranch('stage')
  }

  const readyFrame = { t: 0, version: 0 }
  const reviewFrame = priority ? deferred : { t: reviewTime, version: relocation.decision.state_version }
  const position = step === 'ready' ? readyFrame
    : step === 'approval' ? { t: placement.decision.t, version: placement.decision.state_version }
    : step === 'stored' ? placement.result
    : step === 'review' ? reviewFrame
    : step === 'outcome' ? pickup.result
    : priority ? urgent.result
    : branch === 'stage' ? relocation.result
    : { t: reviewTime, version: Infinity }
  const time = playing ? animationTime : position.t
  const frame = buildFrame(run, time, playing?.motion.result.version ?? position.version)
  const target = playing ? slotOf(playing.motion.decision)
    : step === 'approval' ? originalSlot
    : step === 'review' && !priority ? nearSlot
    : undefined
  const storage = [...frame.occupancy].find(([, id]) => id === cargo.id)?.[0]
  const status = playing?.label ?? (step === 'ready' ? 'Awaiting arrival' : step === 'approval' ? 'On belt · awaiting approval'
    : step === 'outcome' ? 'Delivered to transfer' : storage ? `Stored in ${storage}` : 'At transfer')
  const cutoff = Number(pickup.result.data?.deadline_s)
  const difference = Math.abs(pickup.result.t - cutoff)

  return <>
    <div className="shift-steps" aria-label="Demo progress">
      {intro.map(([number, label], index) => <div key={label} aria-current={index === stepIndex[step] ? 'step' : undefined}
        data-complete={index < stepIndex[step]}><span>{index < stepIndex[step] ? <Check size={14}/> : number}</span>{label}</div>)}
    </div>

    <div className="shift-workspace">
      <section className="shift-board" aria-labelledby="shift-board-title">
        <div className="shift-board-head"><div><div className="eyebrow">SIMULATED FACILITY</div><h2 id="shift-board-title">High-bay storage</h2></div>
          <span className="shift-clock"><Clock3 size={15}/><time>{clock(time)}</time></span></div>
        <RackMap run={run} frame={frame} time={time} target={target} container={cargo.id} belt={step === 'approval' && !playing} status={status}/>
        <div className="shift-board-foot"><span><i data-kind="cargo"/> Tracked container</span><span><i data-kind="target"/> Proposed slot</span>
          <span><i data-kind="closed"/> Under inspection</span></div>
        <div className="shift-board-status" role="status"><Box size={15}/><strong>{cargo.id}</strong><span>{status}</span></div>
      </section>

      <section className="shift-decision" aria-label="Operator decision">
        {playing ? <>
          <div className="eyebrow"><span className="signal"/> MOVE IN PROGRESS</div><h2>{playing.label}</h2>
          <p>The rack map is playing the tray and crane events from the simulator.</p>
          <button className="button" onClick={() => { setStep(playing.next); setPlaying(undefined) }}>Skip animation <ArrowRight size={15}/></button>
        </> : step === 'ready' ? <>
          <div className="eyebrow">01 / INBOUND</div><h2>A container reaches the belt</h2>
          <p>{cargo.id} has a booked pickup at {clock(cargo.appointment_s ?? 0)}. The closest lower positions are still under inspection.</p>
          <button className="button primary" onClick={() => setStep('approval')}><Box size={16}/> Confirm arrival on belt</button>
        </> : step === 'approval' ? <>
          <div className="eyebrow">02 / AWAITING YOUR APPROVAL</div><h2>Store in {originalSlot}</h2>
          <p>The booked pickup takes precedence over the carrier-based dwell estimate. Bay {originalBay} has the closest available lower position.</p>
          <dl className="shift-facts">
            <div><dt>Priority</dt><dd>{cargo.priority} of 5</dd></div>
            <div><dt>Synthetic carrier history</dt><dd>{cargo.carrier} · {fmt(cargo.carrier_delay_days ?? 0, 1)} d typical delay</dd></div>
            <div><dt>Model dwell estimate</dt><dd>{fmt(Number((placement.decision.prediction.pickup as { days: number }).days), 1)} days</dd></div>
            <div><dt>Estimated placement</dt><dd>{duration(placement)} s · {fmt(Number(placement.decision.selected.kwh), 2)} kWh</dd></div>
          </dl>
          <div className="shift-actions"><button className="button primary" onClick={() => play(placement, 'stored', 'Placing container')}><ClipboardCheck size={16}/> Approve placement</button></div>
          <small>The container stays on the belt until you approve.</small>
        </> : step === 'stored' ? <>
          <div className="eyebrow">02 / PLACEMENT COMPLETE</div><h2>Stored in {originalSlot}</h2>
          <p>The tray and crane have finished. Advance to {clock(reviewTime)}: the inspection clears, shorter routes reopen and the crane has an idle window.</p>
          <button className="button primary" onClick={() => setStep('review')}>Review idle window <ArrowRight size={16}/></button>
        </> : step === 'review' ? <>
          <div className="eyebrow">03 / IDLE WINDOW</div>
          <h2>{priority ? 'Defer the reshuffle' : `Stage closer in ${nearSlot}`}</h2>
          {priority ? <p>Priority 5 pickup {demo.priorityContainer} needs the same crane. The scheduler keeps {cargo.id} in {originalSlot} and serves the urgent job first.</p>
            : <><p>The inspection is complete and nothing is queued. A {duration(relocation)}-second rack move now shortens the tray route at pickup.</p>
              <p className="shift-gain"><Zap size={16}/> <strong>{duration(demo.pickups.keep) - duration(demo.pickups.stage)} s less pickup wait · {fmt(runs.keep.metrics.kwh - runs.stage.metrics.kwh, 2)} kWh less energy</strong>
                <span>Compared with leaving it in place in this run.</span></p></>}
          <label className="shift-toggle"><input type="checkbox" checked={priority}
            onChange={(e) => setBranch(e.target.checked ? 'priority' : 'stage')}/><Siren size={17}/> Inject priority pickup</label>
          <div className="shift-actions">
            {priority ? <button className="button primary" onClick={() => play(urgent, 'pickup', 'Serving priority pickup')}>Serve priority pickup <ArrowRight size={15}/></button> : <>
              <button className="button primary" onClick={() => play(relocation, 'pickup', 'Staging container')}><Check size={16}/> Approve reshuffle</button>
              <button className="button" onClick={() => { setBranch('keep'); setStep('pickup') }}>Keep original slot</button>
            </>}
          </div>
        </> : step === 'pickup' ? <>
          <div className="eyebrow">03 / PLAN SET</div>
          <h2>{priority ? 'Priority pickup served' : branch === 'stage' ? 'Staged for pickup' : 'Original slot kept'}</h2>
          <p>{priority ? `${demo.priorityContainer} met its cutoff. The reshuffle was deferred. ` : ''}{cargo.id} is in {pickupSlot}. Its pickup releases at {clock(cargo.appointment_s ?? 0)}.</p>
          <button className="button primary" onClick={() => play(pickup, 'outcome', 'Retrieving container')}>Run booked pickup <ArrowRight size={16}/></button>
        </> : <>
          <div className="eyebrow">04 / PICKUP OUTCOME</div><h2>{isLate(pickup) ? 'Pickup missed its cutoff' : 'Pickup met its cutoff'}</h2>
          <p>{cargo.id} reached the transfer interface in <strong>{duration(pickup)} seconds</strong>, {difference} seconds {isLate(pickup) ? 'after' : 'before'} the cutoff.</p>
          {priority && <p><strong>{demo.priorityContainer}</strong> was served on time first; no reshuffle ran in this branch.</p>}
          <div className="shift-actions"><button className="button primary" onClick={() => { setBranch('stage'); setStep('review') }}>Try another plan <ArrowRight size={16}/></button></div>
        </>}
      </section>
    </div>

    {(step === 'review' || step === 'pickup' || step === 'outcome') && !priority && <ShiftComparison demo={demo}/>}
    {(step === 'review' || step === 'pickup' || step === 'outcome') && priority && <p className="shift-gain priority">
      <ShieldCheck size={18}/> <strong>Released work comes first.</strong> The quiet run's energy comparison does not apply with the extra pickup.
    </p>}
    <div className="shift-disclosure"><span>Curated workload and equipment settings. Results illustrate this simulation only.</span>
      <button className="link-button" onClick={reset}><RotateCcw size={14}/> Reset demo</button></div>
  </>
}

export default function ShiftDemo() {
  const demo = useQuery({ queryKey: ['shift-demo'], queryFn: loadDemo })
  return <div className="shift-page">
    <div className="page-intro">
      <div><div className="eyebrow"><span className="signal"/> GUIDED OPERATIONS DEMO</div><h1>Protect the next pickup</h1>
        <p>Approve a slot at arrival. Then decide whether an idle crane should move the box closer before pickup.</p></div>
      <div className="intro-actions"><span className="badge teal">Recorded simulation</span></div>
    </div>
    {demo.data ? <Session demo={demo.data}/> : demo.isError ? <EvidenceError error={demo.error}/> : <Empty>Loading shift recording…</Empty>}
  </div>
}
