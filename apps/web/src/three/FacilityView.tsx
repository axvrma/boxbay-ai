import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BoxGeometry, CanvasTexture, Color, EdgesGeometry, Object3D, PerspectiveCamera, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import type { InstancedMesh, Mesh } from 'three'
import { category } from '../intelligence/inference'
import { craneOnline, occupied } from '../simulation/engine'
import type { Plan, State } from '../simulation/engine'
import { buffer, home, inbound, outbound, point } from '../simulation/physics'
import type { DemoData, Point, Slot } from '../simulation/types'

export type Camera = 'isometric' | 'front' | 'top'
export type Animation = { plan: Plan; start: number; duration: number }
type Props = {
  data: DemoData; state: State; target?: Slot; selected?: string; onSelect: (id: string) => void
  camera: Camera; cameraVersion: number; animation?: Animation; map: boolean
}
type Box = { at: Point; size: Point; color: string; id?: string }
const backdrop = '#e9eff3'
const colors = { Fast: '#3886bd', Medium: '#ad813e', Long: '#9d5259' }
const edgeBox = new BoxGeometry(1, 1, 1)
const boxEdges = new EdgesGeometry(edgeBox)
edgeBox.dispose()

function Blocks({ items, select, roughness = .72 }: { items: Box[]; select?: (id: string) => void; roughness?: number }) {
  const mesh = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const instance = mesh.current
    if (!instance) return
    const matrix = new Object3D()
    items.forEach(({ at, size, color }, i) => {
      matrix.position.set(...at)
      matrix.scale.set(...size)
      matrix.updateMatrix()
      instance.setMatrixAt(i, matrix.matrix)
      instance.setColorAt(i, new Color(color))
    })
    instance.instanceMatrix.needsUpdate = true
    if (instance.instanceColor) instance.instanceColor.needsUpdate = true
    instance.computeBoundingSphere()
  }, [items])
  if (!items.length) return null
  function click(event: ThreeEvent<MouseEvent>) {
    const item = items[event.instanceId ?? -1]
    if (item?.id && select) {
      event.stopPropagation()
      select(item.id)
    }
  }
  return <instancedMesh key={items.length} ref={mesh} args={[undefined, undefined, items.length]}
    onClick={select ? click : undefined}>
    <boxGeometry />
    <meshStandardMaterial roughness={roughness} metalness={.22} />
  </instancedMesh>
}

function labelTexture(value: string, color: string, fill: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 72
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, 256, 72)
  ctx.fillStyle = color
  ctx.font = 'bold 31px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(value, 128, 38, 240)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function Label({ value, at, tint = '#cfdeeb', background = '#16232c', width = 3.6 }: {
  value: string; at: Point; tint?: string; background?: string; width?: number
}) {
  const texture = useMemo(() => labelTexture(value, tint, background), [value, tint, background])
  useEffect(() => () => texture.dispose(), [texture])
  return <sprite position={at} scale={[width, width * .24, 1]}>
    <spriteMaterial map={texture} toneMapped={false} />
  </sprite>
}

function Cam({ view, cameraVersion, length }: { view: Camera; cameraVersion: number; length: number }) {
  const { camera, invalidate, size } = useThree()
  useLayoutEffect(() => {
    if (camera instanceof PerspectiveCamera) {
      camera.zoom = Math.min(.76, size.width / Math.max(1, size.height) / 1.38)
      camera.updateProjectionMatrix()
      invalidate()
    }
  }, [camera, invalidate, size.height, size.width])
  useLayoutEffect(() => {
    const distance = Math.max(44, length * 1.05)
    if (view === 'top') camera.position.set(length * .43, distance * 1.3, .1)
    else if (view === 'front') camera.position.set(length * .43, 15, distance * 1.24)
    else camera.position.set(-distance * .46, distance * .59, distance * .85)
    camera.lookAt(length * .43, 5, 0)
    invalidate()
  }, [camera, invalidate, view, cameraVersion, length])
  return <OrbitControls makeDefault key={view + cameraVersion} target={[length * .43, 5, 0]}
    enableDamping minDistance={10} maxDistance={distanceLimit(length)} maxPolarAngle={Math.PI * .495} />
}
const distanceLimit = (length: number) => Math.max(140, length * 3)

function staticStructure(data: DemoData) {
  const frame: Box[] = []
  const empty: Box[] = []
  const terms = [...new Set(data.cells.map((cell) => cell.rack))]
  for (const rack of terms) {
    const slots = data.cells.filter((cell) => cell.rack === rack)
    const top = Math.max(...slots.map((cell) => cell.y)) + 1.65
    const z = slots[0].z
    const bays = [...new Set(slots.map((cell) => cell.x))]
    for (const x of [...bays.map((value) => value - 2.58), bays[bays.length - 1] + 2.58]) {
      for (const side of [-1, 1]) {
        frame.push({ at: [x, top / 2, z + 5.35 * side], size: [.23, top, .25], color: '#536b77' })
        frame.push({ at: [x, .1, z + 5.35 * side], size: [.67, .2, .60], color: '#435560' })
      }
      frame.push({ at: [x, top, z], size: [.27, .24, 10.95], color: '#647d86' })
    }
    for (const slot of slots) {
      for (const dz of [-5.35, 5.35]) {
        frame.push({ at: [slot.x, slot.y - 1.20, z + dz], size: [5.2, .25, .23], color: '#657d87' })
      }
      for (const dx of [-1.45, 1.45]) {
        frame.push({ at: [slot.x + dx, slot.y - 1.28, z], size: [.12, .13, 10.88], color: '#405865' })
      }
      empty.push({ id: slot.id, at: [slot.x, slot.y - 1.42, z], size: [4.50, .09, 10.25],
        color: slot.blocked ? '#65707a' : slot.reefer ? '#264f5a' : '#283644' })
    }
    for (const offset of [-5.35, 5.35]) {
      frame.push({ at: [(bays[0] + bays.at(-1)!) / 2, top + .28, z + offset],
        size: [bays.at(-1)! - bays[0] + 5.2, .21, .18], color: '#8a8b70' })
    }
    frame.push({ at: [(bays[0] + bays.at(-1)!) / 2, .10, z], size: [bays.at(-1)! - bays[0] + 5, .12, 3.1], color: '#263842' })
  }
  return { frame, empty }
}

function interpolate(from: Point, to: Point, fraction: number): Point {
  const t = fraction * fraction * (3 - 2 * fraction)
  return from.map((value, i) => value + (to[i] - value) * t) as Point
}

function LiveMove({ animation }: { animation: Animation }) {
  const carrier = useRef<Mesh>(null)
  const cargo = useRef<Mesh>(null)
  const { invalidate } = useThree()
  const legs = animation.plan.legs
  const seconds = legs.reduce((total, leg) => total + leg.seconds, 0)
  useEffect(() => { invalidate() }, [invalidate, animation])
  useFrame(() => {
    let remaining = Math.min(seconds, Math.max(0, (performance.now() - animation.start) / animation.duration * seconds))
    let current = legs[0]
    const last = legs.at(-1)
    let payload = (legs.find((leg) => leg.cargo) ?? current).from
    for (const leg of legs) {
      current = leg
      if (remaining <= leg.seconds || leg === last) break
      if (leg.cargo) payload = leg.to
      remaining -= leg.seconds
    }
    const at = interpolate(current.from, current.to, Math.min(1, remaining / current.seconds))
    const container = current.cargo ? at : payload
    carrier.current?.position.set(at[0], current.equipment === 'tray' ? at[1] - .48 : at[1] + 1.35, at[2])
    cargo.current?.position.set(container[0], Math.max(1.65, container[1]), container[2])
    invalidate()
  })
  return <>
    <mesh ref={carrier}><boxGeometry args={[3.6, .38, 7.4]} /><meshStandardMaterial color="#e7a743" /></mesh>
    <mesh ref={cargo}><boxGeometry args={[2.95, 2.35, animation.plan.cargo.size === 20 ? 4.7 : 9.9]} />
      <meshStandardMaterial color="#43a5df" metalness={.32} roughness={.58} />
    </mesh>
  </>
}

function Rails({ positions, color }: { positions: Point[]; color: string }) {
  const geometry = useMemo(() => {
    const points = positions.map((item) => new Vector3(...item))
    const buffer = new Vector3()
    return points.slice(1).map((to, i) => {
      const from = points[i]
      const midpoint = from.clone().add(to).multiplyScalar(.5)
      const direction = buffer.subVectors(to, from)
      const length = direction.length()
      const rotation = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction.normalize())
      return { midpoint, length, rotation }
    })
  }, [positions])
  return geometry.map(({ midpoint, length, rotation }, i) => <mesh key={i} position={midpoint} quaternion={rotation}>
    <boxGeometry args={[length, .10, .19]} /><meshBasicMaterial color={color} />
  </mesh>)
}

function Warehouse({ data, state, target, selected, onSelect, camera, cameraVersion, animation }: Props) {
  const { frame, empty } = useMemo(() => staticStructure(data), [data])
  const bySlot = useMemo(() => occupied(state.floor), [state.floor])
  const cargo = useMemo(() => data.cells.flatMap((cell) => {
    const item = bySlot.get(cell.id)
    if (!item || animation?.plan.cargo.id === item.cargo.id) return []
    return [{ at: point(cell), size: [2.92, 2.28, item.cargo.size === 20 ? 4.75 : 9.8] as Point,
      color: colors[category(item.days)], id: cell.id, item }]
  }), [animation, bySlot, data.cells])
  const ribs = useMemo(() => cargo.flatMap(({ at, size, color }) => {
    const [x,y,z] = at
    return Array.from({ length: Math.round(size[2] / .58) - 1 }, (_, i) => [-1,1].map((side) => ({
      at: [x + 1.49 * side, y, z - size[2] / 2 + .58 * (i + 1)] as Point,
      size: [.07, 2.18, .08] as Point, color,
    }))).flat()
  }), [cargo])
  const length = Math.max(...data.cells.map((cell) => cell.x)) + 4
  const queue = state.step === 'arrived' || state.step === 'predicted' ? data.incoming[state.cargoIndex] : undefined
  const highlights = [target, data.cells.find((cell) => cell.id === selected)].filter((value): value is Slot => !!value)
  return <>
    <color attach="background" args={[backdrop]} />
    <fog attach="fog" args={[backdrop, 82, 162]} />
    <ambientLight intensity={1.32} />
    <hemisphereLight args={['#e9f4fa', '#9aaeb8', 1.1]} />
    <directionalLight color="#edf6ff" position={[3, 35, 14]} intensity={2.05} />
    <directionalLight color="#74a5cb" position={[24, 15, -35]} intensity={1.4} />
    <Cam view={camera} cameraVersion={cameraVersion} length={length} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[length / 2, -.08, 0]}>
      <planeGeometry args={[length + 60, 78]} /><meshStandardMaterial color="#b6c3cb" roughness={.94} />
    </mesh>
    <gridHelper args={[112, 35, '#8297a4', '#a4b5c0']} position={[length / 2, -.06, 0]} />
    <Blocks items={frame} />
    <Blocks items={empty} select={onSelect} />
    <Blocks items={cargo} select={onSelect} />
    <Blocks items={ribs} roughness={.62} />
    {cargo.map(({ at: [x,y,z], size, item }) => <group key={item.cargo.id}>
      <Label value={item.cargo.id.replace('JA-YARD-', 'YARD ')} at={[x, y + .63, z + (z < 0 ? -1 : 1) * (size[2] / 2 + .12)]} width={2.30} />
      {item.cargo.priority > 1 && <mesh position={[x + 1.18, y + 1.18, z]}><sphereGeometry args={[.18]} />
        <meshBasicMaterial color="#d2a2fa" /></mesh>}
    </group>)}
    {(['A','B'] as const).map((rack) => {
      const [x,y,z] = state.floor.fleet[rack].at
      const top = Math.max(1, ...data.cells.filter((slot) => slot.rack === rack).map((slot) => slot.y)) + 2
      const offline = !craneOnline(rack, state.operation)
      return <group key={rack}>
        {[...new Set(data.cells.filter((slot) => slot.rack === rack).map((slot) => slot.bay))].map((bay) => {
          const cell = data.cells.find((slot) => slot.rack === rack && slot.bay === bay)!
          return <Label key={bay} value={`${rack}${String(bay).padStart(2, '0')}`} at={[cell.x, top + .42, z]} width={2.05} />
        })}
        {[...new Set(data.cells.filter((slot) => slot.rack === rack).map((slot) => slot.level))].map((level) => {
          const cell = data.cells.find((slot) => slot.rack === rack && slot.level === level)!
          return <Label key={level} value={`L${level}`} at={[1.8, cell.y, z + 5.8]} width={1.2} />
        })}
        <mesh position={[x, top, z]}><boxGeometry args={[.92, .48, 10.85]} />
          <meshStandardMaterial color={offline ? '#a8504a' : '#ba8b45'} metalness={.35} /></mesh>
        <mesh position={[x, (top + y) / 2, z]}><boxGeometry args={[.16, top - y, .15]} />
          <meshStandardMaterial color="#c08e43" /></mesh>
        <Label value={`RACK ${rack}`} at={[2.5, top + 1.1, z]} width={5}
          tint={offline ? '#efaea2' : '#b6d8e8'} />
      </group>
    })}
    <Rails positions={[inbound, buffer, home('A')].map(([x,,z]) => [x,.04,z])} color="#9c7950" />
    <Rails positions={[outbound, buffer, home('B')].map(([x,,z]) => [x,.04,z])} color="#8d7554" />
    <Blocks items={[
      { at: [-7, .14, -3], size: [4.6, .29, 4.5], color: '#37617a' },
      { at: [-7, .14, 3], size: [4.6, .29, 4.5], color: '#596e78' },
      { at: [-1.4, .18, 0], size: [3.7, .34, 3.5], color: '#735f3d' },
    ]} />
    <Label value="INBOUND" at={[-8, .95, -6.5]} tint="#d3edff" />
    <Label value="OUTBOUND" at={[-8, .95, 6.4]} />
    <Label value="TRANSFER" at={[-1.3, .82, 2.3]} width={3.2} tint="#ecce97" />
    {queue && !animation && <>
      <mesh position={[inbound[0], 1.57, inbound[2]]}><boxGeometry args={[2.9, 2.2, 4.75]} />
        <meshStandardMaterial color="#3e8fc5" roughness={.55} /></mesh>
      <Label value={queue.id} at={[inbound[0], 3.08, inbound[2]]} tint="#d2eeff" width={4.3} />
    </>}
    {highlights.map((slot, index) => <lineSegments key={`${slot.id}-${index}`} geometry={boxEdges} renderOrder={1}
      position={point(slot)} scale={[4.8, 2.72, 10.8]}>
      <lineBasicMaterial depthTest={slot.id !== target?.id} color={slot.id === target?.id ? '#08764d' : '#206ba2'} />
    </lineSegments>)}
    {target && !animation && <Label value={`AI · ${target.id}`} at={[target.x, target.y + .7, target.z + 5.58]}
      tint="#eafbf1" background="#0b6243" width={3.8} />}
    {target && !animation && <Rails positions={[[inbound[0], .45, inbound[2]], [buffer[0], .45, buffer[2]],
      home(target.rack), [target.x, .5, target.z], point(target)]} color="#0c7951" />}
    {animation && <LiveMove animation={animation} />}
  </>
}

class WebGLBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function SlotMap({ data, state, selected, target, onSelect }: Props) {
  const inventory = occupied(state.floor)
  return <div className="rack-map" aria-label="Two-dimensional storage map">
    {(['A','B'] as const).map((rack) => {
      const cells = data.cells.filter((cell) => cell.rack === rack)
      const bays = Math.max(...cells.map((cell) => cell.bay), 1)
      return <div key={rack}><h3>Rack {rack}</h3>
        <div className="rack-grid" style={{ gridTemplateColumns: `repeat(${bays}, minmax(0, 1fr))` }}>
          {cells.sort((a,b) => b.level-a.level || a.bay-b.bay).map((slot) => {
            const item = inventory.get(slot.id)
            const status = item ? category(item.days) : slot.blocked ? 'Restricted' : 'Open'
            return <button type="button" key={slot.id} data-state={status} data-recommended={target?.id === slot.id}
              aria-pressed={selected === slot.id} title={`${slot.id} · ${item?.cargo.id ?? status}`}
              onClick={() => onSelect(slot.id)}>{slot.id}<small>{item?.cargo.id.replace('JA-', '') ?? status}</small></button>
          })}
        </div>
      </div>
    })}
  </div>
}

function supportsWebGL2() {
  try {
    const probe = document.createElement('canvas')
    probe.width = probe.height = 1
    const context = probe.getContext('webgl2')
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return context !== null
  } catch {
    return false
  }
}

export default function FacilityView(props: Props) {
  const [webGL, setWebGL] = useState(supportsWebGL2)
  const map = <SlotMap {...props} />
  if (props.map || !webGL) return map
  return <WebGLBoundary fallback={map}>
    <Canvas frameloop="demand" dpr={[1, 1.6]} camera={{ fov: 42, near: .2, far: 240 }}
      gl={{ antialias: true, alpha: false }} fallback={map}
      onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => {
        if (gl.domElement.isConnected) setWebGL(false)
      }, { once: true })}
      aria-label="Interactive high-bay storage digital twin">
      <Warehouse {...props} />
    </Canvas>
  </WebGLBoundary>
}
