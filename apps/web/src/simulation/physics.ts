import type { Point, Rates, Slot } from './types'

export const containerHeight = 2.58
export const containerWidth = 2.44
export const containerLength = (size: 20 | 40) => size === 20 ? 6.06 : 12.19
export const rackDepth = 3.25
export const columnPitch = 13.4
export const palletHeight = .32

// X runs along the stacker aisle. The spreader extends on Z to enter either rack.
export const inbound: Point = [-18, 1.68, 0]
export const outbound: Point = [-18, 1.68, 5.4]
export const handoff: Point = [-1, inbound[1], 0]
export const craneHome: Point = [handoff[0], handoff[1] + .70, 0]
export const point = (slot: Slot): Point => [slot.x, slot.y, slot.z]
export const physics = {
  gravity: 9.80665, liftEfficiency: .78, regeneration: .26, tareKg: 4000,
  craneTravel: 3, hoist: 1.3, extension: 1.45, trayTravel: 4.5,
  emptyTraction: .0048, trayEmpty: .0014, trayLoaded: .00012, auxiliaryKw: 3.8, idleKw: .85,
}

export type Leg = {
  equipment: 'tray' | 'crane'
  phase: 'pallet' | 'travel' | 'grip' | 'lift' | 'extend' | 'set-down' | 'release' | 'retract'
  cargo: boolean
  from: Point
  to: Point
  seconds: number
  metres: number
  kwh: number
}

const equalPosition = (a: Point, b: Point) => a.every((value, i) => value === b[i])

function tray(from: Point, to: Point, kg = 0): Leg {
  const metres = Math.hypot(to[0] - from[0], to[2] - from[2])
  return { equipment: 'tray', phase: 'pallet', cargo: kg > 0, from, to, seconds: metres / physics.trayTravel + 1.2,
    metres, kwh: metres * (physics.trayEmpty + kg / 1000 * physics.trayLoaded) }
}

function crane(phase: Leg['phase'], from: Point, to: Point, kg = 0): Leg {
  const alongAisle = Math.abs(to[0] - from[0])
  const extension = Math.abs(to[2] - from[2])
  const rise = to[1] - from[1]
  const positioning = phase === 'grip' || phase === 'release' || phase === 'set-down' ? 2 : .7
  const seconds = Math.max(alongAisle / physics.craneTravel, Math.abs(rise) / physics.hoist) +
    extension / physics.extension + positioning
  const potential = (kg + physics.tareKg) * physics.gravity * rise / 3_600_000
  const lift = rise >= 0 ? potential / physics.liftEfficiency : potential * physics.regeneration
  const distance = alongAisle + extension
  const traction = distance * physics.emptyTraction * (1 + kg / 100_000)
  return { equipment: 'crane', phase, cargo: kg > 0, from, to, seconds, metres: distance + Math.abs(rise),
    kwh: Math.max(0, lift + traction + physics.auxiliaryKw * seconds / 3600) }
}

function palletRoute(from: Point, to: Point, kg = 0): Leg[] {
  if (equalPosition(from, to)) return []
  if (from[0] !== to[0] && from[2] !== to[2]) {
    return [tray(from, inbound, kg), tray(inbound, to, kg)]
  }
  return [tray(from, to, kg)]
}

export function storeLegs(slot: Slot, kg: number, origin: Point, trayPoint: Point = inbound) {
  const target = point(slot)
  const aboveSlot: Point = [slot.x, slot.y + .18, slot.z]
  const aboveRelease: Point = [slot.x, slot.y + .33, slot.z]
  const atTier: Point = [slot.x, aboveSlot[1], 0]
  return [
    ...palletRoute(trayPoint, inbound),
    tray(inbound, handoff, kg),
    ...(!equalPosition(origin, craneHome) ? [crane('travel', origin, craneHome)] : []),
    crane('grip', craneHome, handoff),
    crane('lift', handoff, craneHome, kg),
    crane('travel', craneHome, atTier, kg),
    crane('extend', atTier, aboveSlot, kg),
    crane('set-down', aboveSlot, target, kg),
    crane('release', target, aboveRelease),
    crane('retract', aboveRelease, [slot.x, aboveRelease[1], 0]),
  ]
}

export function pickupLegs(slot: Slot, kg: number, origin: Point, trayPoint: Point = outbound) {
  const source = point(slot)
  const aboveSlot: Point = [slot.x, slot.y + .18, slot.z]
  const atTier: Point = [slot.x, aboveSlot[1], 0]
  return [
    ...palletRoute(trayPoint, handoff),
    crane('travel', origin, atTier),
    crane('extend', atTier, aboveSlot),
    crane('grip', aboveSlot, source),
    crane('lift', source, aboveSlot, kg),
    crane('retract', aboveSlot, atTier, kg),
    crane('travel', atTier, craneHome, kg),
    crane('set-down', craneHome, handoff, kg),
    crane('release', handoff, craneHome),
    ...palletRoute(handoff, outbound, kg),
  ]
}

export function sampleHandling(legs: Leg[], seconds: number) {
  const firstPallet = legs.find((leg) => leg.equipment === 'tray')!
  const firstCrane = legs.find((leg) => leg.equipment === 'crane')!
  let palletAt = firstPallet.from
  let craneAt = firstCrane.from
  let cargoAt = legs.find((leg) => leg.cargo)!.from
  let elapsed = Math.max(0, seconds)
  for (const leg of legs) {
    if (elapsed <= leg.seconds) {
      const ratio = elapsed / leg.seconds
      const eased = ratio * ratio * (3 - 2 * ratio)
      const at = leg.from.map((value, i) => value + (leg.to[i] - value) * eased) as Point
      return {
        phase: leg.phase,
        palletAt: leg.equipment === 'tray' ? at : palletAt,
        craneAt: leg.equipment === 'crane' ? at : craneAt,
        cargoAt: leg.cargo ? at : cargoAt,
      }
    }
    if (leg.equipment === 'crane') craneAt = leg.to
    else palletAt = leg.to
    if (leg.cargo) cargoAt = leg.to
    elapsed -= leg.seconds
  }
  return { phase: null, palletAt, craneAt, cargoAt }
}

export function movement(legs: Leg[], rackAccess = 2) {
  const total = legs.reduce((a, leg) => ({
    seconds: a.seconds + leg.seconds, metres: a.metres + leg.metres, kwh: a.kwh + leg.kwh,
  }), { seconds: 0, metres: 0, kwh: 0 })
  const activeSeconds = legs.filter((leg) => leg.equipment === 'crane').reduce((sum, leg) => sum + leg.seconds, 0)
  return { ...total, kwh: total.kwh + Number(rackAccess > 0) * Math.max(0, total.seconds - activeSeconds) * physics.idleKw / 3600 }
}
export type Movement = ReturnType<typeof movement>

export const cost = (event: Movement, rates: Rates) =>
  event.kwh * rates.electricity + event.metres / 1000 * rates.equipment + event.seconds / 3600 * rates.time
