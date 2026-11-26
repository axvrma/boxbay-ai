import type { Point, Run, SimEvent } from './model'

export type Motion = { event: SimEvent; origin: Point; source: Point; end: Point; finish: number }
export type TrayView = { id: string; xy: Point; container?: string; path?: Point[]; began: number; finish: number }
export type CraneView = { id: string; xy: Point; state: 'idle' | 'moving' | 'failed' | 'recovering'; motion?: Motion }
export type Frame = {
  occupancy: Map<string, string>; reserved: Map<string, string>; blocked: Set<string>
  cranes: Record<string, CraneView>; trays: Record<string, TrayView>; pending: Set<string>; moves: number; pickups: number; late: number; energy: number
  forecast?: SimEvent; recent: SimEvent[]; interventions: SimEvent[]
}
export const significant = new Set([
  'VESSEL_WORKLOAD_UPDATED', 'CRANE_FAILED', 'CRANE_RECOVERED', 'CRANE_MOVE_SUSPENDED',
  'SLA_BREACHED', 'PICKUP_WAITING_FOR_RACK_CRANE', 'HANDLING_TASK_CANCELLED', 'OPERATOR_OVERRIDE_APPLIED', 'OPERATOR_OVERRIDE_REJECTED', 'SIMULATION_FINISHED',
])

export function buildFrame(run: Run, time: number, throughVersion = Infinity): Frame {
  const occupancy = new Map(run.scenario.work.flatMap((w) => w.initial_slot ? [[w.initial_slot, w.container.id]] : []))
  const blocked = new Set((run.scenario.facility.restrictions ?? []).filter((r) => r.blocked).map((r) => r.slot))
  const frame: Frame = {
    occupancy, blocked, reserved: new Map(), pending: new Set(), moves: 0, pickups: 0, late: 0,
    energy: 0, cranes: {}, trays: {}, recent: [], interventions: [],
  }
  const usesTray = Boolean(run.scenario.facility.tray)
  for (const crane of run.scenario.facility.cranes) {
    const rack = run.scenario.facility.racks.find((r) => r.id === crane.racks[0])
    frame.cranes[crane.id] = { id: crane.id, xy: [(rack?.x ?? 0) + (usesTray ? 8 : -9), usesTray ? 1.65 : 0, rack?.z ?? 0], state: crane.available === false ? 'failed' : 'idle' }
  }
  for (const event of run.events) {
    if (event.t > time || event.version > throughVersion) break
    const { kind, slot, crane, container, task } = event
    const data = event.data ?? {}
    const equipment = crane ? frame.cranes[crane] : undefined
    const trayId = String(data.tray ?? '')
    switch (kind) {
      case 'CONTAINER_ARRIVED':
      case 'CONTAINER_DEPARTURE_REQUESTED':
        if (task) frame.pending.add(task)
        break
      case 'SLOT_RESERVED':
        if (slot && container) frame.reserved.set(slot, container)
        break
      case 'SLOT_OCCUPIED':
        if (slot && container) { frame.occupancy.set(slot, container); frame.reserved.delete(slot) }
        break
      case 'SLOT_RELEASED':
        if (slot) frame.occupancy.delete(slot)
        break
      case 'TRAY_MOVE_STARTED': {
        const path = data.path as Point[]
        frame.trays[trayId] = { id: trayId, xy: path[0], path, container: data.loaded ? container ?? undefined : undefined,
          began: event.t, finish: Number(data.finish_s) }
        break
      }
      case 'TRAY_MOVE_COMPLETED':
        frame.energy += Number(data.energy_kwh ?? 0)
        if (data.direction === 'to_interface') delete frame.trays[trayId]
        else frame.trays[trayId] = { id: trayId, xy: data.xyz as Point, container: data.loaded ? container ?? undefined : undefined,
          began: event.t, finish: event.t }
        break
      case 'CONTAINER_HANDOFF':
        if (frame.trays[trayId]) frame.trays[trayId].container = data.direction === 'crane_to_tray' ? container ?? undefined : undefined
        break
      case 'CRANE_MOVE_STARTED':
        if (equipment) {
          equipment.state = 'moving'
          equipment.motion = { event, origin: data.from_xyz as Point, source: data.source_xyz as Point,
            end: data.to_xyz as Point, finish: Number(data.finish_s) }
        }
        break
      case 'CRANE_MOVE_COMPLETED':
        if (equipment) { equipment.state = 'idle'; equipment.xy = data.end_xyz as Point; equipment.motion = undefined }
        frame.energy += Number((data.energy as {kwh: number})?.kwh ?? 0)
        if (usesTray) break
        // Older recordings accounted for the entire request at crane completion.
        if (task) frame.pending.delete(task)
        if (data.operation !== 'relocate') frame.moves += 1
        if (data.operation === 'pickup') frame.pickups += 1
        break
      case 'HANDLING_TASK_COMPLETED':
        if (task) frame.pending.delete(task)
        if (data.operation !== 'relocate') frame.moves += 1
        if (data.operation === 'pickup') frame.pickups += 1
        break
      case 'HANDLING_TASK_CANCELLED':
        if (slot && data.reservation_released) frame.reserved.delete(slot)
        break
      case 'CRANE_FAILED':
        if (equipment) { equipment.state = 'failed'; equipment.motion = undefined }
        break
      case 'CRANE_MOVE_SUSPENDED':
        if (slot && data.reservation_released) frame.reserved.delete(slot)
        frame.energy += Number(data.energy_kwh ?? 0)
        if (data.loaded_on_tray && frame.trays[`TRAY-${String(data.rack)}`]) {
          frame.trays[`TRAY-${String(data.rack)}`].container = container ?? undefined
        }
        break
      case 'CRANE_RECOVERED':
        if (equipment) equipment.state = time - event.t < 30 ? 'recovering' : 'idle'
        break
      case 'SLOT_BLOCKED':
        if (slot) frame.blocked.add(slot)
        break
      case 'SLOT_UNBLOCKED':
        if (slot) frame.blocked.delete(slot)
        break
      case 'SLA_BREACHED':
        frame.late += 1
        break
      case 'SIMULATION_FINISHED':
        frame.energy = run.metrics.kwh
        break
      case 'DEMAND_FORECAST_UPDATED':
        frame.forecast = event
        break
    }
    if (significant.has(kind)) frame.interventions.push(event)
    if (significant.has(kind) || kind === 'CRANE_MOVE_COMPLETED') frame.recent.push(event)
  }
  return frame
}

export function trail(run: Run) {
  const occupancy = run.metrics.initial_inventory
  let stored = occupancy
  const pending = new Set<string>()
  const chart = [{ t: 0, occupancy, backlog: 0 }]
  for (const e of run.events) {
    const { kind, task, t } = e
    if (kind === 'SLOT_OCCUPIED') stored += 1
    else if (kind === 'SLOT_RELEASED') stored -= 1
    else if (kind === 'CONTAINER_ARRIVED' || kind === 'CONTAINER_DEPARTURE_REQUESTED') {
      if (task) pending.add(task)
    } else if ((kind === 'HANDLING_TASK_COMPLETED' || !run.scenario.facility.tray && kind === 'CRANE_MOVE_COMPLETED') && task) pending.delete(task)
    else continue
    chart.push({ t, occupancy: stored, backlog: pending.size })
  }
  chart.push({ t: run.scenario.horizon_s ?? 4800, occupancy: stored, backlog: pending.size })
  return chart
}

export function trayPosition(tray: TrayView, time: number): Point {
  const path = tray.path
  if (!path || path.length < 2) return tray.xy
  const distances = path.slice(1).map((point, index) =>
    Math.hypot(point[0] - path[index][0], point[2] - path[index][2]))
  let remaining = Math.max(0, Math.min(1, (time - tray.began) / (tray.finish - tray.began))) *
    distances.reduce((sum, length) => sum + length, 0)
  for (const [index, length] of distances.entries()) {
    if (remaining <= length && length > 0) {
      const start = path[index]
      const end = path[index + 1]
      return start.map((value, axis) => value + (end[axis] - value) * remaining / length) as Point
    }
    remaining -= length
  }
  return path[path.length - 1]
}
