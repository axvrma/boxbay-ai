import { ArrowDownRight, ArrowRight, ChevronLeft, ChevronRight, CircleCheck, GitCompareArrows, MapPin, MoveUpRight, Sparkles, TriangleAlert } from 'lucide-react'
import { actionLabel, decisionTrace } from '../decisionReplay'
import type { Cursor, Phase } from '../decisionReplay'
import { clock, fmt, titles } from '../model'
import type { Decision, Run } from '../model'
import { placementAlternatives } from '../placementComparison'
import { buildFrame } from '../replay'
import PlacementComparison from './PlacementComparison'

function signed(value: number, digits = 0) {
  return `${value > 0 ? '+' : ''}${fmt(value, digits)}`
}

const triggerLabels: Record<string, string> = {
  CONTAINER_ARRIVED: 'An inbound container was ready for storage.',
  CONTAINER_DEPARTURE_REQUESTED: 'A pickup request was released.',
  CRANE_MOVE_COMPLETED: 'A move finished, freeing equipment or a storage position.',
  CRANE_FAILED: 'A crane went out of service.',
  CRANE_RECOVERED: 'A crane returned to service.',
  SLOT_BLOCKED: 'A storage position was blocked.',
  VESSEL_WORKLOAD_UPDATED: 'A vessel workload notice changed.',
  OPERATOR_OVERRIDE_REQUESTED: 'An operator proposed a different slot.',
}

type StoryProps = {
  run: Run
  decision?: Decision
  cursor: Cursor
  time: number
  version: number
  compare?: Run
  jump: (cursor: Cursor) => void
  inspect: (slotId: string, atDecision?: string) => void
}

export default function DecisionStory({ run, decision, cursor, time, version, compare, jump, inspect }: StoryProps) {
  const decisionJump = (id: string) => jump({ decision: id, phase: 'decision' })
  const current = decision ? run.decisions.indexOf(decision) : -1
  const predictive = run.policy === 'predictive'
  const inputEvent = run.events[version - 1]
  const outlook = inputEvent?.kind === 'DEMAND_FORECAST_UPDATED' ? inputEvent.data : undefined
  const navigator = <div className="decision-navigator">
    <button className="icon-button" title="Previous decision" aria-label="Previous decision" disabled={current <= 0}
      onClick={() => decisionJump(run.decisions[current - 1].id)}><ChevronLeft size={18}/></button>
    <label><span>Jump to a decision</span><select aria-label="Jump to a decision" disabled={!run.decisions.length} value={decision?.id ?? ''}
      onChange={(event) => { if (event.target.value) decisionJump(event.target.value) }}>
      {!decision && <option value="">Choose a decision</option>}
      {run.decisions.map((item, index) => <option value={item.id} key={item.id}>
        {index + 1}. {actionLabel(item.action)} {item.container} · {clock(item.t)}
      </option>)}
    </select></label>
    <button className="icon-button" title="Next decision" aria-label="Next decision" disabled={current >= run.decisions.length - 1}
      onClick={() => decisionJump(run.decisions[current + 1].id)}><ChevronRight size={18}/></button>
  </div>

  if (!decision) return <section className="decision-story panel" aria-label="Decision inspector">
    <div className="decision-hero">
      <div className="decision-kicker"><Sparkles size={16}/>{predictive ? 'AI recommendation' : 'Policy decision'}</div>
      <h2>{inputEvent ? titles[inputEvent.kind] ?? inputEvent.kind.replaceAll('_', ' ') : 'Starting facility state'}</h2>
      {outlook && <p>{fmt(Number(outlook.inbound_requests))} inbound requests expected · {fmt(Number(outlook.notice_count))} announced.</p>}
      {inputEvent?.kind === 'PICKUP_WAITING_FOR_RACK_CRANE' && <p>{inputEvent.container} remains in {inputEvent.slot}. Its dedicated crane, {inputEvent.crane}, is offline.</p>}
      <p>{run.decisions.length ? 'Choose a decision to see the assignment, facility conditions and result.' : 'No assignment was made in this run.'}</p>
    </div>{navigator}
  </section>

  const slotId = String(decision.selected.slot)
  const slot = run.slots.find((item) => item.id === slotId)
  const work = run.scenario.work.find((item) => item.container.id === decision.container)
  const before = buildFrame(run, decision.t, decision.state_version)
  const craneId = String(decision.selected.crane)
  const unavailable = Object.values(before.cranes).filter((crane) => crane.state === 'failed')
  const forecast = decision.prediction.workload as {inbound_requests?: number; low?: number; high?: number; horizon_s?: number; notice_count?: number} | undefined
  const pickup = decision.prediction.pickup as {days?: number; low_days?: number; high_days?: number} | undefined
  const appointment = work?.container.appointment_s
  const trigger = run.events.find((event) => event.id === decision.trigger)
  const { start, handoff, result } = decisionTrace(run, decision)
  const usesTray = Boolean(run.scenario.facility.tray)
  const displayedPhase = 'decision' in cursor && cursor.decision === decision.id ? cursor.phase : undefined
  const simulatedResult = result && version >= result.version
  const matching = compare?.decisions.filter((item) => item.task === decision.task) ?? []
  const other = matching.length === 1 ? matching[0] : undefined
  const recommended = decision.override?.recommended as {slot: string; crane: string} | undefined
  const rejected = Object.entries(decision.rejected).sort((a, b) => b[1] - a[1])
  const comparisons = predictive ? placementAlternatives(decision) : []
  const factors = decision.selected.placement_factors as {
    pickup_soon: boolean; retrieval_cost: number; near_interface_cost: number; powered_slot_cost: number
  } | undefined
  const state = displayedPhase ?? (time === decision.t && version === decision.state_version ? 'decision' : undefined)
  const phaseButton = (phase: Phase, label: string, enabled: boolean) =>
    <button type="button" aria-pressed={state === phase} disabled={!enabled}
      onClick={() => jump({ decision: decision.id, phase })}>{label}</button>
  const timing = Number(decision.selected.slack_s)
  const energy = Number(decision.selected.kwh)
  const handlingFinished = result?.kind === 'HANDLING_TASK_COMPLETED'
  const actualEnergy = run.events.filter((event) => event.version <= version && event.data?.decision === decision.id)
    .reduce((sum, event) => sum + (event.kind === 'TRAY_MOVE_COMPLETED' ? Number(event.data?.energy_kwh)
      : event.kind === 'CRANE_MOVE_COMPLETED' ? Number((event.data?.energy as {kwh?: number})?.kwh ?? 0) : 0), 0)

  return <section className="decision-story panel" aria-label="Decision inspector">
    <div className="decision-hero">
      <div className="decision-topline">
        <span className="decision-kicker"><Sparkles size={16}/>{recommended ? (predictive ? 'AI recommendation · operator override' : 'Operator override') : predictive ? 'AI recommendation' : 'Policy decision'}</span>
        <time>{clock(decision.t)}</time>
      </div>
      <h2>{actionLabel(decision.action)} {decision.container}</h2>
      <button type="button" className="decision-location" onClick={() => inspect(slotId)} title="Inspect the selected slot in the facility">
        <MapPin size={19}/><span>{slot ? `Rack ${slot.rack.replace(/^R(?=\d)/, '')} · Bay ${slot.bay} · Level ${slot.level}` : slotId}</span>
        <MoveUpRight size={15}/>
      </button>
      <div className="decision-meta"><span className="mono">{slotId}</span><span>{craneId} {usesTray ? `serves ${slot?.rack ?? "this rack"}` : "assigned"}</span></div>
      {recommended && <div className="override-callout">
        <strong>{predictive ? 'AI proposed' : 'Policy proposed'} {recommended.slot}</strong><ArrowRight size={14}/>
        <span>Operator chose {slotId} <small>{signed(Number(decision.override?.delta_seconds))} s · {signed(Number(decision.override?.delta_kwh), 2)} kWh</small></span>
      </div>}
    </div>
    <div className="decision-body">
      <div className="decision-section">
        <h3>Why this choice</h3>
        <p>{recommended ? 'The engine checked the operator’s slot against the same placement rules before dispatching the move.'
          : decision.action === 'pickup' && unavailable.length > 0
            ? `${unavailable.map((crane) => crane.id).join(', ')} unavailable. ${craneId} serves the container’s rack.`
            : predictive && decision.action === 'store'
              ? factors?.pickup_soon === true
                ? 'Pickup was expected soon, so the planner gave extra weight to the travel needed to retrieve this container.'
                : factors?.pickup_soon === false
                  ? 'Pickup was farther out, so the planner weighed this move against keeping near-interface space open for incoming work.'
                  : 'The planner weighs the immediate move against future pickup travel and predicted demand.'
              : predictive && decision.action === 'relocate'
                ? 'The planner estimated that changing slots would save enough future pickup cost to justify an extra move.'
                : decision.action === 'pickup'
                  ? usesTray ? 'The tray stages below the container. Its own rack crane lowers it, and the tray takes it to the interface.'
                    : 'The container already had a storage slot. The dispatch decision was which available crane could serve it.'
                  : run.policy === 'fifo' ? 'The FIFO policy looked for an available safe slot in queue order.'
                    : run.policy === 'legacy' ? 'The legacy policy scored eligible slots using expected dwell tier and modeled movement energy.'
                      : 'The reactive policy weighed available equipment, movement time, energy and task deadlines.'}</p>
        {forecast?.inbound_requests != null && <div className="decision-signal">
          <ArrowDownRight size={17}/><span><strong>{fmt(forecast.inbound_requests)} inbound expected</strong>
            {' '}over the next {fmt((forecast.horizon_s ?? 0) / 60)} min
            {forecast.notice_count ? ` · ${fmt(forecast.notice_count)} announced` : ''}</span>
        </div>}
        <div className="decision-facts" aria-label="Conditions at the decision">
          <span>{before.occupancy.size}/{run.slots.length} slots occupied</span>
          <span>{before.pending.size} open {before.pending.size === 1 ? 'task' : 'tasks'}</span>
          <span>{unavailable.length ? `${unavailable.length} ${unavailable.length === 1 ? 'crane' : 'cranes'} offline` : 'All cranes in service'}</span>
          {decision.action === 'store' && (appointment != null
            ? <span>Pickup booked {clock(appointment)}</span>
            : pickup?.days != null ? <span>Estimated stay {fmt(pickup.days, 1)} days</span> : null)}
        </div>
      </div>
      {comparisons.length > 0 && <PlacementComparison key={decision.id} decision={decision} alternatives={comparisons}
        inspect={(id) => inspect(id, decision.id)}/>}
      <div className="decision-section">
        <h3>Expected impact for this move</h3>
        <div className="decision-impact">
          <div><strong>{fmt(Number(decision.selected.seconds))} s</strong><span>Estimated move</span></div>
          <div><strong>{fmt(energy, 2)} kWh</strong><span>Estimated energy</span></div>
          <div><strong>{fmt(Math.abs(timing))} s</strong><span>{timing < 0 ? 'Past deadline' : 'Before deadline'}</span></div>
        </div>
        {usesTray && Number(decision.selected.tray_seconds) > 0 && <p className="handling-breakdown">
          {fmt(Number(decision.selected.tray_seconds))} s tray travel and docking · {fmt(Number(decision.selected.crane_seconds))} s rack crane
        </p>}
      </div>
      <div className="decision-section decision-replay">
        <div className={`decision-phase ${handoff ? 'has-handoff' : ''}`} role="group" aria-label="Assignment stages">
          {phaseButton('decision', 'At decision', true)}
          {phaseButton('dispatch', usesTray && Number(decision.selected.tray_seconds) > 0 ? 'Tray departs' : 'At dispatch', Boolean(start))}
          {handoff && phaseButton('handoff', 'Crane starts', true)}
          {phaseButton('result', 'At outcome', Boolean(result))}
        </div>
        {simulatedResult ? <p className="decision-result">
          {(result.kind === 'CRANE_MOVE_SUSPENDED' || result.kind === 'HANDLING_TASK_CANCELLED') ?
            <><TriangleAlert size={16}/><span>Handling interrupted at {clock(result.t)}. {decision.action === 'pickup'
              ? 'The container stayed in its rack.' : 'The tray returns the incoming container to the interface.'}</span></>
            : <><CircleCheck size={16}/><span>Simulated move completed at {clock(result.t)}{result.data?.late ? ' after its deadline.' : ' on time.'}
              {' '}{fmt(handlingFinished ? actualEnergy : Number((result.data?.energy as {kwh?: number})?.kwh ?? energy), 2)} kWh for the move.</span></>}
        </p> : <p className="decision-result muted">{state === 'decision' ? 'Facility paused at the choice, before this move starts.'
          : start && version >= start.version ? state === 'dispatch' && usesTray ? 'The tray takes the lower route. The crane stays in its own rack.'
              : state === 'handoff' ? 'The dedicated rack crane takes over after the tray arrives.'
                : 'The assignment is executing at this point in the replay.'
            : 'Use the stages to inspect the decision, dispatch and simulated result.'}</p>}
      </div>
      <details className="decision-evidence">
        <summary>{comparisons.length ? 'More decision evidence' : 'Decision evidence and alternatives'}</summary>
        <p>{triggerLabels[trigger?.kind ?? ''] ?? (trigger ? titles[trigger.kind] ?? trigger.kind : 'Scenario review')}
          {' '}{fmt(decision.candidate_count)} feasible {decision.action === 'pickup' ? 'assignments' : 'crane and slot options'} passed the initial checks.</p>
        {!comparisons.length && decision.alternatives.map((option, index) => <div className="decision-alternative" key={index}>
          <button className="link-button" onClick={() => inspect(String(option.slot), decision.id)}>{String(option.slot)}</button>
          <span>{String(option.crane)} · {fmt(Number(option.seconds))} s · {fmt(Number(option.kwh), 2)} kWh</span>
        </div>)}
        {other && predictive && <div className="baseline-choice"><GitCompareArrows size={16}/><p>
          <strong>Same request in the separate reactive run</strong>
          <span>{clock(other.t)} · {String(other.selected.slot)} · {String(other.selected.crane)} · {fmt(Number(other.selected.seconds))} s · {fmt(Number(other.selected.kwh), 2)} kWh</span>
        </p></div>}
        {rejected.length > 0 && <p>{rejected.map(([label, count]) => `${label.toLowerCase()} (${count})`).join(' · ')}</p>}
        {pickup?.low_days != null && pickup.high_days != null && <p>Estimated dwell range {fmt(pickup.low_days, 1)}–{fmt(pickup.high_days, 1)} days.</p>}
        {forecast?.low != null && forecast.high != null && <p>Estimated inbound range {fmt(forecast.low)}–{fmt(forecast.high)} requests.</p>}
        <p className="mono">{decision.id} · event {decision.state_version} · option score {String(decision.selected.cost)} · {decision.status.replaceAll('_', ' ')}</p>
      </details>
    </div>
    {navigator}
  </section>
}
