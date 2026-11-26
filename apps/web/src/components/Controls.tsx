import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useSession } from '../client'
import type { Facility } from '../model'

export function Dialog({ title, close, children }: {title: string; close: () => void; children: ReactNode}) {
  const element = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = element.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={element} className="dialog" aria-label={title}
    onCancel={(event) => { event.preventDefault(); close() }}
    onClick={(event) => { if (event.target === element.current) close() }}>
    <div className="dialog-content">
      <div className="panel-head"><h2>{title}</h2><button type="button" className="icon-button" title="Close" aria-label="Close" onClick={close}><X size={20}/></button></div>
      {children}
    </div>
  </dialog>
}

export function TokenInput() {
  const {token, setToken} = useSession()
  const [value, setValue] = useState(token)
  return <form onSubmit={(e) => { e.preventDefault(); setToken(value.trim()) }} className="form-row">
    <label>Operator access token<input value={value} type="password" autoComplete="off" onChange={(e) => setValue(e.target.value)} /></label>
    <button className="button" type="submit">Save for session</button>
  </form>
}

export function resizeFacility(source: Facility, rackCount: number, online?: number): Facility {
  if (rackCount === source.racks.length && online === undefined) return source
  const racks = source.racks.slice(0, rackCount)
  while (racks.length < rackCount) {
    let n = racks.length + 1
    while (racks.some((r) => r.id === `R${n}`)) n += 1
    racks.push({ ...racks[0], id: `R${n}`, z: Math.max(...racks.map((r) => r.z ?? 0)) + 19, available: true })
  }
  const used = new Set(source.cranes.map((crane) => crane.id))
  const cranes = racks.map((rack, index) => {
    const existing = source.cranes.find((crane) => crane.racks[0] === rack.id)
    if (existing) return { ...existing, available: online === undefined ? existing.available : index < online }
    let next = index + 1
    while (used.has(`CR-${String(next).padStart(2, '0')}`)) next += 1
    const id = `CR-${String(next).padStart(2, '0')}`
    used.add(id)
    return { ...source.cranes[0], id, zone: rack.id, racks: [rack.id], available: online === undefined || index < online }
  })
  const ids = new Set(racks.map((rack) => rack.id))
  return { ...source, version: (source.version ?? 1) + 1, racks, cranes,
    restrictions: (source.restrictions ?? []).filter((r) => ids.has(r.slot.split(':')[0])) }
}

export function Topology({ config, apply }: {config: Facility; apply: (facility: Facility) => string | void}) {
  const [draft, setDraft] = useState(config)
  const [advanced, setAdvanced] = useState(false)
  const [serialized, setSerialized] = useState('')
  const [error, setError] = useState('')
  const updateRack = (index: number, key: string, value: unknown) => setDraft((previous) => ({
    ...previous, racks: previous.racks.map((rack, i) => index === i ? { ...rack, [key]: value } : rack),
  }))
  const updateCrane = (index: number, key: string, value: unknown) => setDraft((previous) => ({
    ...previous, cranes: previous.cranes.map((crane, i) => index === i ? { ...crane, [key]: value } : crane),
  }))
  return <form onSubmit={(e) => {
    e.preventDefault()
    try {
      const value: Facility = advanced ? JSON.parse(serialized) : draft
      setError(apply({ ...value, version: (config.version ?? 1) + 1 }) ?? '')
    } catch { setError('The facility configuration must contain valid JSON.') }
  }}>
    <p className="muted">Each rack has its own crane. The tray network serves all racks. Topology changes create a fresh seeded scenario.</p>
    <div className="form-row">
      <label>Racks<input type="number" min="1" max="8" value={draft.racks.length}
        onChange={(e) => { const n = e.target.valueAsNumber; if (n >= 1 && n <= 8) setDraft(resizeFacility(draft, n)) }}/></label>
      <button type="button" className="button" onClick={() => {
        if (!advanced) setSerialized(JSON.stringify(draft, null, 2))
        setAdvanced(!advanced)
      }}>{advanced ? 'Form editor' : 'Advanced JSON'}</button>
    </div>
    {advanced ? <label>Facility config<textarea rows={14} value={serialized} onChange={(e) => setSerialized(e.target.value)}/></label>
      : <div className="topology-grid">
        <div><h3>Storage racks</h3>{draft.racks.map((rack, i) => <fieldset key={rack.id}>
          <legend>{rack.id}</legend>
          <div className="form-row">
            <label>Bays<input type="number" min="1" max="24" value={rack.bays} onChange={(e) => updateRack(i, 'bays', Number(e.target.value))}/></label>
            <label>Levels<input type="number" min="1" max="10" value={rack.levels} onChange={(e) => updateRack(i, 'levels', Number(e.target.value))}/></label>
            <label>Bay pitch, m<input type="number" min="14.5" max="40" step=".1" value={rack.bay_pitch_m} onChange={(e) => updateRack(i, 'bay_pitch_m', Number(e.target.value))}/></label>
          </div>
        </fieldset>)}</div>
        <div><h3>Dedicated cranes</h3>{draft.cranes.map((crane, i) => <fieldset key={crane.id}>
          <legend>{crane.id}</legend>
          <label className="checkbox"><input type="checkbox" checked={crane.available !== false}
            onChange={(e) => updateCrane(i, 'available', e.target.checked)} /> Available</label>
          <p className="muted">Serves {crane.racks[0]}</p>
        </fieldset>)}</div>
      </div>}
    {error && <p className="notice error">{error}</p>}
    <div className="form-row"><button className="button primary">Apply and simulate</button></div>
  </form>
}
