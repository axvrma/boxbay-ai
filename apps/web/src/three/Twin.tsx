import { Component, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, Line, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { BoxGeometry, Color, EdgesGeometry, Object3D } from 'three'
import type { InstancedMesh } from 'three'
import { Box, Focus, Layers3, Maximize2, RotateCcw, TrainTrack } from 'lucide-react'
import type { Point, Run, Slot } from '../model'
import { trayPosition } from '../replay'
import type { Frame, Motion } from '../replay'

type Props = {
  run: Run; frame: Frame; time: number; selection?: string; select: (slot: Slot) => void
  decisionSlot?: string; decisionCrane?: string; decisionId?: string
}
const highlight = '#77f5d2'
const inspectionColor = '#fae694'
const slotOutline = new EdgesGeometry(new BoxGeometry(14.1, 2.9, 3.15))
type Block = { pos: Point; size: Point; color: string; slot?: Slot }
const paint = ['#d47c49', '#4f9b9b', '#426f9b', '#c39a4f', '#53717d', '#819fa3']
const tint = (id: string) => paint[Array.from(id).reduce((n, char) => (n * 31 + char.charCodeAt(0)) >>> 0, 0) % paint.length]
const interpolate = (a: Point, b: Point, t: number): Point => a.map((p, i) => p + (b[i] - p) * t) as Point
export const cranePosition = (motion: Motion, time: number) => {
  const elapsed = Math.min(1, Math.max(0, (time - motion.event.t) / (motion.finish - motion.event.t)))
  return elapsed < 0.35 ? interpolate(motion.origin, motion.source, elapsed / 0.35)
    : interpolate(motion.source, motion.end, (elapsed - 0.35) / 0.65)
}

function Blocks({ blocks, onPick, opacity = 1 }: { blocks: Block[]; onPick?: (slot: Slot) => void; opacity?: number }) {
  const nodes = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = nodes.current
    if (!mesh) return
    const dummy = new Object3D()
    blocks.forEach(({ pos, size, color }, i) => {
      dummy.position.set(...pos)
      dummy.scale.set(...size)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, new Color(color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [blocks])
  if (!blocks.length) return null
  return <instancedMesh ref={nodes} args={[undefined, undefined, blocks.length]}
    onPointerOver={onPick ? (e) => { e.stopPropagation(); document.body.style.cursor = 'pointer' } : undefined}
    onPointerOut={onPick ? () => { document.body.style.cursor = '' } : undefined}
    onClick={onPick ? (e) => {
      e.stopPropagation()
      const slot = e.instanceId !== undefined ? blocks[e.instanceId]?.slot : undefined
      if (slot) onPick(slot)
    } : undefined}>
    <boxGeometry args={[1, 1, 1]} />
    <meshStandardMaterial roughness={0.71} metalness={0.2} transparent={opacity < 1} opacity={opacity} />
  </instancedMesh>
}

function Warehouse({ run, frame, time, selection, select, decisionSlot, decisionCrane, decisionId, camera }: Props & {camera: number}) {
  const racks = run.scenario.facility.racks
  const usesTray = Boolean(run.scenario.facility.tray)
  const trayColor = '#ffcc70'
  const spineX = Math.min(...racks.map((rack) => rack.x)) - 13
  const spineZ = Math.min(...racks.map((rack) => rack.z)) - 8
  const endZ = Math.max(...racks.map((rack) => rack.z + ((rack.positions ?? 1) - 1) * 4)) + 4
  const maxX = Math.max(...run.slots.map((s) => s.xyz[0])) + 13
  const minX = Math.min(...run.slots.map((s) => s.xyz[0])) - 30
  const maxZ = Math.max(...run.slots.map((s) => s.xyz[2])) + 13
  const minZ = Math.min(...run.slots.map((s) => s.xyz[2])) - 15
  const span = Math.max(maxX - minX, (maxZ - minZ) * 1.3, 35)
  const center: Point = [(minX + maxX) / 2, 4, (minZ + maxZ) / 2]
  const structure = useMemo(() => racks.flatMap((rack) => {
    const pillars: Block[] = []
    const h = rack.levels * rack.level_pitch_m + (usesTray ? 5 : 1.7)
    const base = usesTray ? 3.45 : .45
    const width = (rack.positions ?? 1) * 4
    const length = rack.bays * rack.bay_pitch_m
    for (let i = 0; i <= rack.bays; i += 1) {
      const x = rack.x + 0.5 + i * rack.bay_pitch_m
      for (const z of [rack.z - 1.85, rack.z + width - 2.15]) {
        pillars.push({ pos: [x, h / 2, z], size: [.34, h, .42], color: '#49627a' })
        for (let j = 0; j <= rack.levels; j += 1) {
          pillars.push({ pos: [x, base + j * rack.level_pitch_m, z], size: [.68, .12, .65], color: '#8aa3b2' })
        }
      }
      for (let j = 0; j <= rack.levels; j += 1) {
        pillars.push({ pos: [x, base + j * rack.level_pitch_m, rack.z + (width - 4) / 2],
          size: [.26, .18, width], color: '#536c80' })
      }
    }
    for (let j = 0; j <= rack.levels; j += 1) {
      for (const z of [rack.z - 1.85, rack.z + width - 2.15]) {
        pillars.push({ pos: [rack.x + length / 2, base + j * rack.level_pitch_m, z],
          size: [length, .2, .28], color: '#5c778d' })
      }
    }
    return pillars
  }), [racks, usesTray])
  const work = useMemo(() => new Map(run.scenario.work.map((w) => [w.container.id, w.container])), [run])
  const active = Object.values(frame.cranes).flatMap((c) => c.motion ? [c.motion] : [])
  const lifting = new Set(active.filter((m) => time - m.event.t >= (m.finish - m.event.t) * .35).map((m) => m.event.container))
  const containers: Block[] = []
  const ribs: Block[] = []
  const locations: Block[] = []
  for (const slot of run.slots) {
    const cid = frame.occupancy.get(slot.id)
    const cargo = cid ? work.get(cid) : undefined
    const selected = selection === slot.id
    if (cid && cargo && !lifting.has(cid)) {
      const length = cargo.size_ft * .3048
      const color = selected ? inspectionColor : tint(cid)
      containers.push({ pos: slot.xyz, size: [length, 2.57, 2.44], color, slot })
      if (run.slots.length < 420) {
        for (let i = 1; i < 11; i += 1) {
          const x = slot.xyz[0] + length * (i / 11 - .5)
          ribs.push({ pos: [x, slot.xyz[1], slot.xyz[2] + 1.226], size: [.08, 2.35, .035], color })
        }
      }
    } else {
      const color = selected ? inspectionColor : frame.blocked.has(slot.id) ? '#ea5b5d'
        : frame.reserved.has(slot.id) ? '#3cd8ca' : '#364b60'
      locations.push({ pos: [slot.xyz[0], slot.xyz[1] - 1.37, slot.xyz[2]],
        size: [12.8, selected ? .19 : .075, 2.65], color, slot })
    }
  }
  const chosen = run.slots.find((slot) => slot.id === decisionSlot)
  const inspected = selection === decisionSlot ? undefined : run.slots.find((slot) => slot.id === selection)
  const focused = inspected ?? chosen
  const paths = useMemo(() => run.events.flatMap((event) => {
    if (!decisionId || !event.data || event.data.decision !== decisionId) return []
    if (event.kind === 'CRANE_MOVE_STARTED') return [{ id: event.id, color: highlight,
      points: [event.data.from_xyz, event.data.source_xyz, event.data.to_xyz] as Point[] }]
    if (event.kind === 'TRAY_MOVE_STARTED' && event.data.direction === 'to_rack') return [{
      id: event.id, color: trayColor, points: event.data.path as Point[],
    }]
    return []
  }), [run, decisionId, trayColor])
  const handoffX = chosen?.xyz[0] ?? spineX + 40
  const handoffZ = chosen?.xyz[2] ?? endZ
  const trayTarget: Point = [(spineX + handoffX) / 2, 2, (spineZ + handoffZ) / 2]
  const traySpan = Math.max(handoffX - spineX, handoffZ - spineZ, 35)
  const presets: Point[] = [
    [center[0] + span * .39, span * .43, center[2] + span * .96],
    [center[0], span * 1.06, center[2] + .01],
    focused ? [focused.xyz[0] + 11, focused.xyz[1] + 15, focused.xyz[2] + 25] : [center[0], span * .54, center[2] + span],
    [trayTarget[0] - traySpan * .91, traySpan * .31 + 3, trayTarget[2] + traySpan * .78],
  ]
  const view = camera % 4
  const target: Point = view === 2 && focused ? focused.xyz
    : view === 3 ? trayTarget : center
  const cameraKey = view === 2 ? `${camera}-${focused?.id ?? ''}` : view === 3 ? `${camera}-${chosen?.id ?? ''}` : camera

  return <>
    <color attach="background" args={['#101c2d']} />
    <fog attach="fog" args={['#101c2d', span * 1.7, span * 4]} />
    <PerspectiveCamera makeDefault key={cameraKey} position={presets[view]} fov={view === 3 ? 49 : 44} near={.1} far={7000} />
    <OrbitControls key={cameraKey} target={target} makeDefault enableDamping minDistance={12} maxDistance={span * 2.3} maxPolarAngle={Math.PI * .49} />
    <ambientLight intensity={1.12} />
    <hemisphereLight args={['#c3e3fc', '#2a354c', 1.15]} />
    <directionalLight position={[minX, span, maxZ]} intensity={2.25} color="#fff1e0" />
    <directionalLight position={[maxX, span / 3, minZ]} intensity={.82} color="#7bd8ea" />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], -.045, center[2]]}>
      <planeGeometry args={[span * 5, span * 5]} /><meshStandardMaterial color="#172436" roughness={.96} />
    </mesh>
    <Grid position={[center[0], -.03, center[2]]} args={[span * 3, span * 3]} cellSize={4} cellThickness={.35}
      cellColor="#294055" sectionSize={16} sectionThickness={.77} sectionColor="#34516a"
      fadeDistance={span * 2} infiniteGrid />
    <Blocks blocks={structure} />
    <Blocks blocks={locations} onPick={select} />
    <Blocks blocks={containers} onPick={select} />
    <Blocks blocks={ribs} />
    {usesTray && <>
      <mesh position={[spineX, .005, (spineZ + endZ) / 2]}>
        <boxGeometry args={[3.4, .1, endZ - spineZ]}/><meshStandardMaterial color="#314557"/>
      </mesh>
      {[-1, 1].map((side) => <mesh key={side} position={[spineX + side * 1.15, .09, (spineZ + endZ) / 2]}>
        <boxGeometry args={[.14, .13, endZ - spineZ]}/><meshStandardMaterial color="#c59c61" metalness={.45}/>
      </mesh>)}
      {racks.flatMap((rack) => Array.from({length: rack.positions ?? 1}, (_, index) => {
        const z = rack.z + index * 4
        const end = rack.x + rack.bays * rack.bay_pitch_m
        return <group key={`${rack.id}-${index}`} position={[(end + spineX) / 2, 0, z]}>
          <mesh position={[0, .02, 0]}><boxGeometry args={[end - spineX, .12, 3.15]}/><meshStandardMaterial color="#25394b"/></mesh>
          {[-1, 1].map((side) => <mesh key={side} position={[0, .11, side * 1.03]}>
            <boxGeometry args={[end - spineX, .12, .12]}/><meshStandardMaterial color="#c59c61" metalness={.45}/>
          </mesh>)}
        </group>
      }))}
    </>}
    {!usesTray && racks.map((rack) => <group key={rack.id} position={[rack.x - 9, .06, rack.z]}>
      <mesh position={[0, .1, 0]}><boxGeometry args={[13, .2, 4.5]} /><meshStandardMaterial color="#567c90" /></mesh>
      {[0, 1].map((n) => <mesh key={n} position={[0, .212, 2.15 - n * 4.3]}>
        <boxGeometry args={[13, .028, .12]} /><meshStandardMaterial color="#d2a85f" /></mesh>)}
    </group>)}
    {chosen && <group position={chosen.xyz}>
      <lineSegments geometry={slotOutline} renderOrder={3}>
        <lineBasicMaterial color={highlight} depthTest={false} depthWrite={false} transparent opacity={.95}/>
      </lineSegments>
      <mesh position={[0, -1.37, 0]}>
        <boxGeometry args={[13.8, .07, 3]}/><meshBasicMaterial color={highlight} transparent opacity={.62}/>
      </mesh>
    </group>}
    {chosen && inspected && <lineSegments position={inspected.xyz} geometry={slotOutline} renderOrder={3}>
      <lineBasicMaterial color={inspectionColor} depthTest={false} depthWrite={false} transparent opacity={.95}/>
    </lineSegments>}
    {paths.map(({ id, color, points }) => <Line key={id} points={points} color={color} lineWidth={2}
      transparent opacity={.82} depthWrite={false}/>)}
    {Object.values(frame.trays).map((tray) => {
      const pos = trayPosition(tray, time)
      const length = (work.get(tray.container ?? '')?.size_ft ?? 40) * .3048
      return <group key={tray.id} position={pos}>
        <mesh position={[0, -1.4, 0]}><boxGeometry args={[13.9, .36, 2.8]}/><meshStandardMaterial color={trayColor}/></mesh>
        {[-5, 5].map((x) => <mesh key={x} position={[x, -1.57, 0]}>
          <boxGeometry args={[.75, .2, 2.5]}/><meshStandardMaterial color="#3a4851"/>
        </mesh>)}
        {tray.container && <mesh><boxGeometry args={[length, 2.5, 2.42]}/><meshStandardMaterial color={tint(tray.container)}/></mesh>}
      </group>
    })}
    {Object.values(frame.cranes).map((c) => {
      const p = c.motion ? cranePosition(c.motion, time) : c.xy
      const chosenCrane = c.id === decisionCrane
      const color = c.state === 'failed' ? '#ef6c69' : chosenCrane ? highlight : c.state === 'recovering' ? '#ecbd72' : '#e0ae62'
      const holder = run.scenario.facility.cranes.find((crane) => crane.id === c.id)
      const home = racks.find((rack) => rack.id === holder?.racks[0])
      const height = home ? home.levels * home.level_pitch_m + (usesTray ? 5 : 4) : 20
      const carried = c.motion && (lifting.has(c.motion.event.container) ? p : c.motion.event.data?.operation === 'store' ? c.motion.source : undefined)
      return <group key={c.id} position={[p[0], 0, p[2] + 3.4]}>
        {chosenCrane && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .1, 0]}>
          <ringGeometry args={[1.8, 2, 36]}/><meshBasicMaterial color={highlight} transparent opacity={.8}/>
        </mesh>}
        <mesh position={[0, height / 2, 0]}><boxGeometry args={[.46, height, .58]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[0, height - .2, -1.1]}><boxGeometry args={[1.35, .57, 3.1]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[0, .42, 0]}><boxGeometry args={[2.2, .84, 1.2]} /><meshStandardMaterial color={color} /></mesh>
        <mesh position={[0, Math.max(.5, p[1]), -1.16]}><boxGeometry args={[1.15, .64, 2.8]} /><meshStandardMaterial color={color} /></mesh>
        {c.motion && carried && <mesh position={[carried[0] - p[0], carried[1], carried[2] - (p[2] + 3.4)]}>
          <boxGeometry args={[(work.get(c.motion.event.container ?? '')?.size_ft ?? 40) * .3048, 2.5, 2.42]} />
          <meshStandardMaterial color={tint(c.motion.event.container ?? '')} />
        </mesh>}
      </group>
    })}
  </>
}

export class TwinBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export function SlotMap({ run, frame, selection, select, decisionSlot }: Props) {
  return <div className="slot-map">
    {run.scenario.facility.racks.map((rack) => <section key={rack.id}>
      <strong>{rack.id}</strong>
      <div style={{ gridTemplateColumns: `repeat(${rack.bays}, minmax(18px, 1fr))` }}>
        {run.slots.filter((s) => s.rack === rack.id).sort((a, b) => b.level - a.level || a.bay - b.bay)
          .map((s) => <button key={s.id} title={s.id === decisionSlot ? `${s.id} · Decision slot` : s.id} aria-label={s.id} aria-pressed={s.id === selection}
            data-decision={s.id === decisionSlot}
            data-state={frame.blocked.has(s.id) ? 'blocked' : frame.occupancy.has(s.id) ? 'occupied'
              : frame.reserved.has(s.id) ? 'reserved' : 'empty'} onClick={() => select(s)} />)}
      </div>
    </section>)}
  </div>
}

export default function Twin(props: Props) {
  const [camera, setCamera] = useState(0)
  const [mode, setMode] = useState<'3d' | 'map'>('3d')
  const inspecting = props.selection && props.selection !== props.decisionSlot
  const focusLabel = inspecting ? 'Focus on inspected slot' : 'Focus on decision slot'
  return <div className="twin" role="region" aria-label="Interactive high-bay facility">
    {mode === '3d' ? <TwinBoundary fallback={<><p className="scene-fallback">WebGL unavailable · Slot map</p><SlotMap {...props} /></>}>
      <Canvas frameloop="demand" dpr={[1, 1.55]} performance={{ min: .7 }} gl={{ antialias: true }} fallback={<SlotMap {...props} />}>
        <Warehouse {...props} camera={camera} />
      </Canvas>
    </TwinBoundary> : <SlotMap {...props} />}
    <div className="scene-overlay">
      <span><span className="signal" /> {mode === '3d' ? '3D facility' : 'Slot map'}</span>
      <span>{props.run.scenario.facility.racks.length} racks · {props.run.slots.length} positions</span>
      {props.decisionSlot && <span className="scene-decision"><i/> {props.decisionSlot} · {props.decisionCrane}</span>}
      {inspecting && props.decisionSlot && <span className="scene-inspection"><i/> {props.selection} · Inspecting</span>}
    </div>
    <div className="camera-controls">
      <button title="Isometric view" aria-label="Isometric view" onClick={() => { setMode('3d'); setCamera(0) }}><Box size={16}/></button>
      <button title="Overhead view" aria-label="Overhead view" onClick={() => { setMode('3d'); setCamera(1) }}><Maximize2 size={15}/></button>

      {(props.selection || props.decisionSlot) && <button title={focusLabel} aria-label={focusLabel}
        onClick={() => { setMode('3d'); setCamera((n) => (Math.floor(n / 4) + 1) * 4 + 2) }}><Focus size={16}/></button>}
      {props.run.scenario.facility.tray && <button title="Under-rack tray view" aria-label="Under-rack tray view"
        onClick={() => { setMode('3d'); setCamera((n) => (Math.floor(n / 4) + 1) * 4 + 3) }}><TrainTrack size={15}/></button>}
      <button title="Accessible slot map" aria-label="Accessible slot map" onClick={() => setMode((m) => m === '3d' ? 'map' : '3d')}><Layers3 size={16}/></button>
      <button title="Reset camera" aria-label="Reset camera" onClick={() => { setMode('3d'); setCamera((n) => (Math.floor(n / 4) + 1) * 4) }}><RotateCcw size={15}/></button>
    </div>
    <div className="scene-legend"><span><i className="cargo-dot"/>Occupied</span><span><i className="free-dot"/>Open</span>
      <span><i className="reserve-dot"/>Reserved</span><span><i className="blocked-dot"/>Restricted</span>
      {props.run.scenario.facility.tray && <span><i className="tray-dot"/>Tray / rails</span>}</div>
  </div>
}
