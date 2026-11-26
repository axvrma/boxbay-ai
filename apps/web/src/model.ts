import type { components } from './contracts.generated'

type Schemas = components['schemas']
export type Run = Schemas['Run']
export type Facility = Run['scenario']['facility']
export type Slot = Run['slots'][number]
export type SimEvent = Run['events'][number]
export type Decision = Run['decisions'][number]
export type Metrics = Run['metrics']
export type Policy = Run['policy']
export type Scenario = Run['scenario']
export type Intervention = NonNullable<Scenario['interventions']>[number]
export type Job = Schemas['JobStatus']
export type RunInput = Schemas['RunInput']
export type Benchmark = Schemas['Benchmark']
export type ScenarioId = RunInput['scenario']
export type Point = [number, number, number]
export type Catalog = { scenarios: Schemas['ScenarioEntry'][]; policies: Policy[]; seed: number }
export type Score = {
  n: number; mae: number; rmse: number; wape_pct: number; bias: number; peak_mae: number; coverage_pct?: number
}
export type Demand = {
  selected: string
  test: Record<string, Score>
  selected_test: Score
  holdout: { month: string; observed: number; prediction: number; low: number; high: number; error: number }[]
}
export type ModelEvidence = {
  version: string
  dataset_version: string
  historical_sha256: string
  synthetic_sha256: string
  seed: number
  demand: { import: Demand; export: Demand }
  dwell: { baseline: Score; test: Score; unseen_carrier: Score; holdout: {actual: number; prediction: number; error: number}[] }
  historical: { month: string; loaded_import_teu: number; loaded_export_teu: number }[]
}
export type SourceManifest = {
  sources: { id: string; name: string; publisher: string; url: string; access: string; coverage: string; limitations: string }[]
}
export const labels: Record<Policy, string> = {
  predictive: 'Predictive AI', reactive: 'Reactive optimizer', fifo: 'FIFO baseline', legacy: 'Legacy tiering',
}
export const titles: Record<string, string> = {
  DEMAND_FORECAST_UPDATED: 'Demand forecast updated', VESSEL_WORKLOAD_UPDATED: 'Vessel workload updated',
  CRANE_FAILED: 'Crane unavailable', CRANE_RECOVERED: 'Crane recovered',
  CONTAINER_ARRIVED: 'Inbound request released', CONTAINER_DEPARTURE_REQUESTED: 'Pickup requested',
  CRANE_MOVE_STARTED: 'Rack crane moves', CRANE_MOVE_COMPLETED: 'Crane leg complete',
  TRAY_MOVE_STARTED: 'Tray departs', TRAY_MOVE_COMPLETED: 'Tray arrives', CONTAINER_HANDOFF: 'Tray and crane handoff',
  HANDLING_TASK_COMPLETED: 'Handling cycle complete', HANDLING_TASK_CANCELLED: 'Handling cycle interrupted',
  PICKUP_WAITING_FOR_RACK_CRANE: 'Pickup waiting for its rack crane',
  SLA_AT_RISK: 'Pickup deadline at risk', SLA_BREACHED: 'Pickup deadline breached',
  SLOT_BLOCKED: 'Slot blocked', SLOT_UNBLOCKED: 'Slot reopened',
  OPERATOR_OVERRIDE_APPLIED: 'Operator override applied', OPERATOR_OVERRIDE_REJECTED: 'Operator override rejected',
  CRANE_MOVE_SUSPENDED: 'Movement suspended', SIMULATION_FINISHED: 'Simulation finished',
}
export const fmt = (n: number, digits = 0) => new Intl.NumberFormat('en-US', {
  maximumFractionDigits: digits, minimumFractionDigits: digits,
}).format(n)
export const clock = (seconds: number) =>
  new Date(Math.max(0, Math.floor(seconds)) * 1000).toISOString().slice(11, 19)
