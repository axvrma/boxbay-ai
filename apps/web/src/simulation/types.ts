export type Rack = 'A' | 'B'
export type Point = [number, number, number]
export type Cargo = {
  id: string
  commodity: number
  lane: number
  receiver: number
  size: 20 | 40
  kg: number
  kind: 'dry' | 'reefer' | 'hazard'
  priority: number
  customs: number
  vessel: number
}
export type Slot = {
  id: string
  rack: Rack
  bay: number
  level: number
  x: number
  y: number
  z: number
  maxKg: number
  sizes: (20 | 40)[]
  reefer: boolean
  hazard: boolean
  blocked: boolean
  reserved: boolean
}
export type Operating = {
  id: string
  name: string
  occupancy: number
  congestion: number
  truck: number
  vessel: number
  cranes: number
}
export type Rates = { electricity: number; equipment: number; time: number; emissions: number; usd: number }
export type DemoData = {
  schema: 1
  defaultDate: string
  dateMin: string
  dateMax: string
  cells: Slot[]
  initial: { cargo: Cargo; slot: string; ageDays: number; actualDwellDays: number; arrivalScenario?: string }[]
  incoming: Cargo[]
  receivers: { id: string; name: string; dwell: number; reliability: number }[]
  vessels: { id: string; name: string; lane: number; scheduledDay: number; containers: number }[]
  events: { kind: number; date: string; before: number; after: number; duration: number }[]
  eventNames: string[]
  commodities: string[]
  ports: string[]
  destinations: string[]
  regions: string[]
  scenarios: Operating[]
  rates: Rates
}
