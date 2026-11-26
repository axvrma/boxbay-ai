import type { Point, Rack, Rates, Slot } from './types'

export const inbound: Point = [-7, .5, -3]
export const outbound: Point = [-7, .5, 3]
export const buffer: Point = [-1.4, .5, 0]
export const home = (rack: Rack): Point => [1.8, .5, rack === 'A' ? -8 : 8]
export const point = (slot: Slot): Point => [slot.x, slot.y, slot.z]
export const physics = {
  gravity: 9.80665, liftEfficiency: .78, regeneration: .26, tareKg: 4000,
  craneTravel: 3, hoist: 1.3, handling: 7, trayTravel: 4.5,
  emptyTraction: .0048, trayEmpty: .0014, trayLoaded: .00012, auxiliaryKw: 3.8, idleKw: .85,
}

export type Leg = {
  equipment: 'tray' | 'crane'
  cargo: boolean
  from: Point
  to: Point
  seconds: number
  metres: number
  kwh: number
}

function horizontal(a: Point, b: Point) {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

function tray(from: Point, to: Point, kg = 0): Leg {
  const metres = horizontal(from, to)
  return { equipment: 'tray', cargo: kg > 0, from, to, seconds: metres / physics.trayTravel + 2,
    metres, kwh: metres * (physics.trayEmpty + kg / 1000 * physics.trayLoaded) }
}

function crane(from: Point, to: Point, kg = 0): Leg {
  const distance = horizontal(from, to)
  const rise = to[1] - from[1]
  const seconds = distance / physics.craneTravel + Math.abs(rise) / physics.hoist + physics.handling
  const potential = (kg + physics.tareKg) * physics.gravity * rise / 3_600_000
  const lift = rise >= 0 ? potential / physics.liftEfficiency : potential * physics.regeneration
  const traction = distance * physics.emptyTraction * (1 + kg / 100_000)
  return { equipment: 'crane', cargo: kg > 0, from, to, seconds, metres: distance + Math.abs(rise),
    kwh: Math.max(0, lift + traction + physics.auxiliaryKw * seconds / 3600) }
}

export function storeLegs(slot: Slot, kg: number, origin: Point, trayPoint: Point = inbound) {
  const handoff = home(slot.rack)
  const target = point(slot)
  return [
    ...(trayPoint === inbound ? [] : [tray(trayPoint, inbound)]),
    tray(inbound, buffer, kg), tray(buffer, handoff, kg), crane(origin, handoff),
    crane(handoff, target, kg), crane(target, handoff),
  ]
}

export function pickupLegs(slot: Slot, kg: number, origin: Point, trayPoint: Point = outbound) {
  const handoff = home(slot.rack)
  const source = point(slot)
  return [tray(trayPoint, handoff), crane(origin, source), crane(source, handoff, kg),
    tray(handoff, outbound, kg)]
}

export function relocationLegs(source: Slot, target: Slot, kg: number, origin: Point) {
  return [crane(origin, point(source)), crane(point(source), point(target), kg), crane(point(target), home(target.rack))]
}

export function movement(legs: Leg[], activeCranes = 2) {
  const total = legs.reduce((a, leg) => ({
    seconds: a.seconds + leg.seconds, metres: a.metres + leg.metres, kwh: a.kwh + leg.kwh,
  }), { seconds: 0, metres: 0, kwh: 0 })
  const occupiedCraneSeconds = legs.filter((leg) => leg.equipment === 'crane').reduce((sum, leg) => sum + leg.seconds, 0)
  return { ...total, kwh: total.kwh + Math.max(0, activeCranes * total.seconds - occupiedCraneSeconds) * physics.idleKw / 3600 }
}
export type Movement = ReturnType<typeof movement>

export const cost = (event: Movement, rates: Rates) =>
  event.kwh * rates.electricity + event.metres / 1000 * rates.equipment + event.seconds / 3600 * rates.time
