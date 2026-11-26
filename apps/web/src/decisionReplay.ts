import type { Decision, Run, SimEvent } from './model'
import { comparePlacement, placementAlternatives } from './placementComparison'

export type Phase = 'decision' | 'dispatch' | 'handoff' | 'result'
export type Cursor = { time: number } | { event: number } | { decision: string; phase: Phase }
export type Moment = { label: string; cursor: Cursor }

export const actionLabel = (action: string) => action === 'pickup' ? 'Retrieve' : action === 'relocate' ? 'Relocate' : 'Store'

export function decisionTrace(run: Run, decision: Decision) {
  const events = run.events.slice(decision.state_version)
  const matches = (event: SimEvent) => event.data?.decision === decision.id
  const tray = events.find((event) => event.kind === 'TRAY_MOVE_STARTED' && matches(event))
  const lift = events.find((event) => event.kind === 'CRANE_MOVE_STARTED' && matches(event))
  const start = tray ?? lift
  const handoff = tray && lift
  const result = start && events.find((event) => {
    if (event.kind === 'HANDLING_TASK_COMPLETED' || event.kind === 'HANDLING_TASK_CANCELLED') return matches(event)
    if (event.kind === 'CRANE_MOVE_SUSPENDED') {
      return matches(event) || (!event.data?.decision && event.version > start.version &&
        event.task === start.task && event.crane === start.crane)
    }
    return !run.scenario.facility.tray && event.kind === 'CRANE_MOVE_COMPLETED' &&
      event.version > start.version && event.task === start.task && event.crane === start.crane
  })
  return { start, handoff, result }
}

export function resolveCursor(run: Run, cursor: Cursor) {
  if ('decision' in cursor) {
    const decision = run.decisions.find((item) => item.id === cursor.decision)
    if (decision) {
      const trace = decisionTrace(run, decision)
      const event = cursor.phase === 'dispatch' ? trace.start : cursor.phase === 'handoff' ? trace.handoff : cursor.phase === 'result' ? trace.result : undefined
      return { time: event?.t ?? decision.t, version: event?.version ?? decision.state_version, decision }
    }
  }
  const event = 'event' in cursor ? run.events[cursor.event - 1] : undefined
  const time = 'time' in cursor ? cursor.time : event?.t ?? 0
  const version = 'event' in cursor ? event?.version ?? 0
    : run.events.filter((item) => item.t <= time).at(-1)?.version ?? 0
  const visible = run.decisions.filter((item) => item.t <= time && item.state_version <= version)
  if (event?.kind === 'PICKUP_WAITING_FOR_RACK_CRANE') return { time, version, decision: undefined }
  const linked = event?.data?.decision
  const decision = (linked ? visible.find((item) => item.id === linked) : event?.task
    ? visible.filter((item) => item.task === event.task && (!event.crane || item.selected.crane === event.crane)).at(-1)
    : undefined) ?? visible.at(-1)
  return { time, version, decision }
}

export function guidedMoments(run: Run): Moment[] {
  const moments: Moment[] = []
  const selectDecision = (label: string, decision?: Decision) => {
    if (decision) moments.push({ label, cursor: { decision: decision.id, phase: 'decision' } })
  }
  const selectEvent = (label: string, event?: SimEvent) => {
    if (event) moments.push({ label, cursor: { event: event.version } })
  }
  const find = (kind: SimEvent['kind']) => run.events.find((event) => event.kind === kind)
  const placement = run.decisions.find((decision) => decision.action === 'store')
  switch (run.scenario.id) {
    case 'surge': {
      const forecast = run.events.find((event) =>
        event.kind === 'DEMAND_FORECAST_UPDATED' && Number(event.data?.notice_count) > 0)
      const anticipated = run.decisions.find((decision) => decision.action === 'store' &&
        forecast && decision.state_version >= forecast.version)
      selectDecision('Place ahead of the surge', anticipated ?? placement)
      selectEvent('Demand forecast rises', forecast)
      const firstVesselPlacement = run.decisions.find((decision) =>
        decision.action === 'store' && run.scenario.work.some((item) =>
          item.container.id === decision.container && item.container.vessel))
      selectDecision('Handle the first vessel container', firstVesselPlacement)
      if (run.policy === 'predictive' && forecast) {
        selectDecision('Keep a closer slot open', run.decisions.find((decision) => {
          if (decision.state_version < forecast.version || decision === anticipated || decision === firstVesselPlacement) return false
          const alternatives = placementAlternatives(decision)
          if (alternatives.some((option) => Number(option.cost) < Number(decision.selected.cost))) return false
          const [option] = alternatives
          const comparison = option && comparePlacement(decision, option)
          return comparison && comparison.timeDifference > 0 && comparison.scoreAdvantage > 0 &&
            comparison.leadingFactor?.key === 'nearInterface'
        }))
      }
      break
    }
    case 'unexpected': {
      const notice = find('VESSEL_WORKLOAD_UPDATED')
      selectDecision('Place after the surprise', run.decisions.find((decision) =>
        decision.action === 'store' && notice && decision.state_version >= notice.version) ?? placement)
      selectEvent('Unexpected vessel notice', run.events.find((event) =>
        event.kind === 'DEMAND_FORECAST_UPDATED' && notice && event.version > notice.version &&
        Number(event.data?.notice_count) > 0) ?? notice)
      break
    }
    case 'breakdown': {
      const waiting = find('PICKUP_WAITING_FOR_RACK_CRANE')
      const usedRack = waiting?.slot?.split(':')[0]
      const recovery = waiting && run.events.find((event) =>
        event.kind === 'CRANE_RECOVERED' && event.crane === waiting.crane && event.version > waiting.version)
      const redirected = waiting && run.decisions.find((decision) => decision.action === 'store' &&
        decision.state_version >= waiting.version && (!recovery || decision.state_version < recovery.version) &&
        !String(decision.selected.slot).startsWith(`${usedRack}:`))
      const resumed = waiting && run.decisions.find((decision) =>
        decision.task === waiting.task && recovery && decision.state_version >= recovery.version)
      const returned = run.events.find((event) => event.kind === 'TRAY_MOVE_COMPLETED' &&
        event.data?.loaded && event.data.direction === 'to_interface' &&
        run.events[event.version]?.kind === 'HANDLING_TASK_CANCELLED')
      const retried = returned && run.decisions.find((decision) =>
        decision.task === returned.task && decision.state_version >= returned.version && decision.selected.crane !== returned.crane)
      selectDecision('Place inbound in a working rack', retried ?? redirected ?? placement)
      const backToInterface = returned && run.events.find((event) => event.kind === 'TRAY_MOVE_STARTED' &&
        event.task === returned.task && event.data?.decision === returned.data?.decision && event.data?.direction === 'to_interface')
      selectEvent('Tray returns with inbound load', backToInterface)
      selectEvent('Pickup waits for its rack crane', waiting)
      selectEvent('Rack crane returns', recovery ?? find('CRANE_RECOVERED'))
      selectDecision('Resume pickup in the same rack', resumed)
      break
    }
    case 'override':
      selectDecision('Compare the operator’s slot', run.decisions.find((decision) => decision.override) ?? placement)
      selectEvent('Override applied', find('OPERATOR_OVERRIDE_APPLIED'))
      break
    case 'energy':
      selectDecision('Inspect a placement trade-off', run.decisions.filter((decision) => decision.action === 'store')[1] ?? placement)
      break
    default:
      selectDecision(placement ? 'Inspect the first placement' : 'Inspect the first assignment', placement ?? run.decisions[0])
  }
  selectEvent('End of run', find('SIMULATION_FINISHED'))
  return moments
}

export function initialCursor(run: Run): Cursor {
  const first = guidedMoments(run)[0]?.cursor
  return first && 'decision' in first ? first : { time: 0 }
}
