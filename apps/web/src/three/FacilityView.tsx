import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BoxGeometry, CanvasTexture, Color, EdgesGeometry, Object3D, PerspectiveCamera, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import type { Group, InstancedMesh } from 'three'
import { category } from '../intelligence/inference'
import { incomingCargo, occupied } from '../simulation/engine'
import type { Plan, State } from '../simulation/engine'
import { columnPitch, containerHeight, containerLength, containerWidth, handoff, inbound, outbound, palletHeight,
  point, rackDepth, sampleHandling, storeLegs } from '../simulation/physics'
import type { DemoData, Point, Slot } from '../simulation/types'

export type Camera = 'isometric' | 'front' | 'top'
export type Animation = { plan: Plan; start: number; duration: number }
type Props = {
  data: DemoData; state: State; target?: Slot; selected?: string; onSelect: (id: string) => void
  camera: Camera; cameraVersion: number; animation?: Animation; manualTarget: boolean; map: boolean
  busy: boolean; onRestrictSlot: (id: string, blocked: boolean) => void
}
type Box = { at: Point; size: Point; color: string; id?: string; tilt?: number }
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
    items.forEach(({ at, size, color, tilt }, i) => {
      matrix.position.set(...at)
      matrix.scale.set(...size)
      matrix.rotation.z = tilt ?? 0
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
    const distance = Math.max(48, length * .90)
    if (view === 'top') camera.position.set(length * .35, distance * 1.3, .1)
    else if (view === 'front') camera.position.set(length * .35, 15, distance * 1.24)
    else camera.position.set(-distance * .33, distance * .53, distance * .85)
    camera.lookAt(length * .35, 5, 0)
    invalidate()
  }, [camera, invalidate, view, cameraVersion, length])
  return <OrbitControls makeDefault key={view + cameraVersion} target={[length * .35, 5, 0]}
    enableDamping minDistance={10} maxDistance={distanceLimit(length)} maxPolarAngle={Math.PI * .495} />
}
const distanceLimit = (length: number) => Math.max(140, length * 3)

function staticStructure(cells: readonly Slot[]) {
  const frame: Box[] = []
  const empty: Box[] = []
  const racks = [...new Set(cells.map((cell) => cell.rack))]
  for (const rack of racks) {
    const slots = cells.filter((cell) => cell.rack === rack)
    const top = Math.max(...slots.map((cell) => cell.y)) + 2
    const z = slots[0].z
    const side = Math.sign(z)
    const faces = [z - rackDepth / 2, z + rackDepth / 2]
    const bays = [...new Set(slots.map((cell) => cell.x))].sort((a, b) => a - b)
    const edges = [...bays.map((x) => x - columnPitch / 2), bays.at(-1)! + columnPitch / 2]
    for (const x of edges) {
      for (const face of faces) {
        frame.push({ at: [x, top / 2, face], size: [.25, top, .27], color: '#526d7b' })
        frame.push({ at: [x, .10, face], size: [.62, .2, .61], color: '#3f5766' })
      }
      frame.push({ at: [x, top, z], size: [.26, .24, rackDepth + .4], color: '#657d8b' })
    }
    for (const slot of slots) {
      const deck = slot.y - containerHeight / 2
      for (const face of faces) {
        frame.push({ at: [slot.x, deck - .15, face], size: [columnPitch, .24, .21], color: '#637e8d' })
      }
      for (const offset of [-5.8, -2.9, 2.9, 5.8]) {
        frame.push({ at: [slot.x + offset, deck - .12, z], size: [.15, .18, rackDepth], color: '#526d7b' })
      }
      // Braces are on the outer face to leave the aisle-facing opening clear for the spreader.
      if (slot.bay === 1 || slot.bay === bays.length) {
        const height = Math.min(3.4, deck - .1)
        frame.push({ at: [slot.x, deck - height / 2, z + side * rackDepth / 2],
          size: [Math.hypot(columnPitch, height), .10, .10], tilt: Math.atan2(height, columnPitch), color: '#647e8b' })
      }
      empty.push({ id: slot.id, at: [slot.x, deck - .043, z], size: [columnPitch - .24, .08, rackDepth - .12],
        color: slot.blocked ? '#89949e' : slot.reefer ? '#799da2' : '#7a8f9d' })
    }
    for (const face of faces) {
      frame.push({ at: [(edges[0] + edges.at(-1)!) / 2, top, face],
        size: [edges.at(-1)! - edges[0], .28, .23], color: '#586e7b' })
    }
  }
  return { frame, empty }
}

const industrialYellow = '#bf862c'
const cargoSize = (size: 20 | 40): Point => [containerLength(size), containerHeight, containerWidth]
const equipmentOrigin: Point = [0, 0, 0]

function StackerEquipment({ floor, height, animation, cargoColor, offline }: {
  floor: State['floor']; height: number; animation?: Animation; cargoColor: string; offline: boolean
}) {
  const portal = useRef<Group>(null)
  const carriage = useRef<Group>(null)
  const spreader = useRef<Group>(null)
  const arms = useRef<Group>(null)
  const pallet = useRef<Group>(null)
  const payload = useRef<Group>(null)
  const { invalidate } = useThree()
  const color = offline ? '#925c51' : industrialYellow
  const legs = animation?.plan.legs
  const seconds = legs?.reduce((total, leg) => total + leg.seconds, 0) ?? 0
  const start = legs ? sampleHandling(legs, 0) : undefined
  const at = start?.craneAt ?? floor.stacker.at
  const plate = start?.palletAt ?? floor.trayAt
  const payloadSize = animation ? cargoSize(animation.plan.cargo.size) : undefined
  const gripReach = payloadSize ? payloadSize[0] / 2 - .25 : 5.8
  const deckOffset = containerHeight / 2 + palletHeight / 2
  const spreaderOffset = containerHeight / 2 + .19

  useEffect(() => { invalidate() }, [animation, invalidate])
  useFrame(() => {
    if (!animation || !legs) return
    const elapsed = Math.min(seconds, Math.max(0, (performance.now() - animation.start) / animation.duration * seconds))
    const pose = sampleHandling(legs, elapsed)
    const [x, y, z] = pose.craneAt
    portal.current?.position.set(x, 0, 0)
    carriage.current?.position.set(0, y + spreaderOffset, 0)
    spreader.current?.position.set(0, 0, z)
    arms.current?.position.set(0, 0, z / 2)
    arms.current?.scale.set(1, 1, Math.abs(z) + 1)
    pallet.current?.position.set(pose.palletAt[0], pose.palletAt[1] - deckOffset, pose.palletAt[2])
    payload.current?.position.set(...pose.cargoAt)
    if (elapsed < seconds) invalidate()
  })

  return <>
    <group ref={pallet} position={[plate[0], plate[1] - deckOffset, plate[2]]}>
      {[-.95, .95].map((z) => <mesh key={z} position={[0, 0, z]}>
        <boxGeometry args={[12.55, palletHeight, .36]}/><meshStandardMaterial color={industrialYellow} metalness={.28}/>
      </mesh>)}
      {[-5.75, -2.8, 2.8, 5.75].map((x) => <mesh key={x} position={[x, -.08, 0]}>
        <boxGeometry args={[.45, .16, 2.45]}/><meshStandardMaterial color="#876837"/>
      </mesh>)}
    </group>
    <group ref={portal} position={[at[0], 0, 0]}>
      {[-6.55, 6.55].map((x) => <group key={x} position={[x, 0, 0]}>
        <mesh position={[0, height / 2, 0]}><boxGeometry args={[.43, height, .68]}/><meshStandardMaterial color={color}/></mesh>
        <mesh position={[0, .30, 0]}><boxGeometry args={[.88, .53, 4.25]}/><meshStandardMaterial color={color}/></mesh>
        {[-1.85, 1.85].map((z) => <mesh key={z} position={[0, .20, z]}>
          <boxGeometry args={[.98, .39, .52]}/><meshStandardMaterial color="#46535a"/>
        </mesh>)}
      </group>)}
      <mesh position={[0, height, 0]}><boxGeometry args={[13.55, .62, .70]}/><meshStandardMaterial color={color}/></mesh>
      <group ref={carriage} position={[0, at[1] + spreaderOffset, 0]}>
        <mesh position={[0, .36, 0]}><boxGeometry args={[13.2, .47, .62]}/><meshStandardMaterial color={color}/></mesh>
        <group ref={arms} position={[0, 0, at[2] / 2]} scale={[1, 1, Math.abs(at[2]) + 1]}>
          {[-gripReach, gripReach].map((x) => <mesh key={x} position={[x, .08, 0]}>
            <boxGeometry args={[.30, .24, 1]}/><meshStandardMaterial color={color} metalness={.26}/>
          </mesh>)}
        </group>
        <group ref={spreader} position={[0, 0, at[2]]}>
          {[-.93, .93].map((z) => <mesh key={z} position={[0, 0, z]}>
            <boxGeometry args={[gripReach * 2 + .35, .26, .25]}/><meshStandardMaterial color={color}/>
          </mesh>)}
          {[-gripReach, gripReach].map((x) => <mesh key={x} position={[x, 0, 0]}>
            <boxGeometry args={[.32, .23, 2.22]}/><meshStandardMaterial color={color}/>
          </mesh>)}
        </group>
      </group>
    </group>
    {animation && start && payloadSize && <group ref={payload} position={start.cargoAt}>
      <mesh position={equipmentOrigin}><boxGeometry args={payloadSize}/>
        <meshStandardMaterial color={cargoColor} roughness={.63}/></mesh>
      <Label value={animation.plan.cargo.id} at={[0, .26, containerWidth / 2 + .12]} width={4.25}/>
    </group>}
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

function Warehouse({ data, state, target, selected, onSelect, camera, cameraVersion, animation, manualTarget }: Props) {
  const { frame, empty } = useMemo(() => staticStructure(state.cells), [state.cells])
  const bySlot = useMemo(() => occupied(state.floor), [state.floor])
  const cargo = useMemo(() => state.cells.flatMap((cell) => {
    const item = bySlot.get(cell.id)
    if (!item || animation?.plan.cargo.id === item.cargo.id) return []
    return [{ at: point(cell), size: cargoSize(item.cargo.size),
      color: colors[category(item.days)], id: cell.id, item }]
  }), [animation, bySlot, state.cells])
  const ribs = useMemo(() => cargo.flatMap(({ at, size, color }) => {
    const [x,y,z] = at
    return Array.from({ length: Math.round(size[0] / .43) - 1 }, (_, i) => [-1,1].map((side) => ({
      at: [x - size[0] / 2 + .43 * (i + 1), y, z + (containerWidth / 2 + .027) * side] as Point,
      size: [.066, containerHeight - .18, .065] as Point, color,
    }))).flat()
  }), [cargo])
  const length = Math.max(...state.cells.map((cell) => cell.x)) + columnPitch / 2
  const height = Math.max(...state.cells.map((cell) => cell.y)) + 3.25
  const queue = state.step === 'placed' ? undefined : incomingCargo(state, data)
  const cargoColor = state.decision ? colors[state.decision.prediction.category] : colors.Fast
  const actualPickup = animation?.plan.kind === 'pickup'
    ? state.floor.inventory.find((item) => item.cargo.id === animation.plan.cargo.id) : undefined
  const animatedColor = actualPickup ? colors[category(actualPickup.days)] : cargoColor
  const targetColor = manualTarget ? '#206ba2' : '#08764d'
  const previewLegs = target && queue && !animation
    ? storeLegs(target, queue.kg, state.floor.stacker.at, state.floor.trayAt).filter((leg) => leg.cargo) : []
  const railStart = [handoff[0] - 7, .055] as const
  const highlights = [target, state.cells.find((cell) => cell.id === selected)].filter((value): value is Slot => !!value)
  return <>
    <color attach="background" args={[backdrop]} />
    <fog attach="fog" args={[backdrop, 155, 300]} />
    <ambientLight intensity={1.32} />
    <hemisphereLight args={['#e9f4fa', '#9aaeb8', 1.1]} />
    <directionalLight color="#edf6ff" position={[3, 35, 14]} intensity={2.05} />
    <directionalLight color="#74a5cb" position={[24, 15, -35]} intensity={1.4} />
    <Cam view={camera} cameraVersion={cameraVersion} length={length} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[length * .42, -.08, 0]}>
      <planeGeometry args={[length + 110, 130]} /><meshStandardMaterial color="#b6c3cb" roughness={.94} />
    </mesh>
    <gridHelper args={[210, 64, '#8297a4', '#a4b5c0']} position={[length * .42, -.06, 0]} />
    <Blocks items={frame} />
    <Blocks items={empty} select={onSelect} />
    <Blocks items={cargo} select={onSelect} />
    <Blocks items={ribs} roughness={.62} />
    {cargo.map(({ at: [x,y,z], size, item }) => <group key={item.cargo.id}>
      <Label value={item.cargo.id.replace('JA-YARD-', 'YARD ')} at={[x, y + .63, z + Math.sign(z) * (size[2] / 2 + .12)]} width={2.30} />
      {item.cargo.priority > 1 && <mesh position={[x + size[0] / 2 - .34, y + 1.24, z]}><sphereGeometry args={[.18]} />
        <meshBasicMaterial color="#d2a2fa" /></mesh>}
    </group>)}
    {(['A', 'B'] as const).map((rack) => {
      const cells = state.cells.filter((slot) => slot.rack === rack)
      const z = cells[0].z
      const face = z + Math.sign(z) * (rackDepth / 2 + .12)
      return <group key={rack}>
        {cells.filter((cell) => cell.level === 1).map((cell) => <Label key={cell.id}
          value={`${rack}${String(cell.bay).padStart(2, '0')}`} at={[cell.x, height - .83, face]} width={2.95} />)}
        {cells.filter((cell) => cell.bay === 1).map((cell) => <Label key={cell.id}
          value={`R${cell.level}`} at={[cell.x - columnPitch / 2 - .65, cell.y, face]} width={1.6} />)}
        <Label value={`RACK ${rack}`} at={[4.4, height + .3, face]} width={5.8}/>
      </group>
    })}
    {[-1.85, 1.85].map((z) => <Rails key={z}
      positions={[[railStart[0], railStart[1], z], [length + 6.7, railStart[1], z]]} color="#596a72" />)}
    {[-.95, .95].map((offset) => <Rails key={offset}
      positions={[[outbound[0] + offset, .018, outbound[2]], [inbound[0] + offset, .018, offset],
        [handoff[0], .018, offset]]} color="#946e37" />)}
    <Blocks items={[
      { at: [inbound[0], .15, inbound[2]], size: [12.95, .28, 3.1], color: '#617d8c' },
      { at: [outbound[0], .14, outbound[2]], size: [12.95, .26, 3.1], color: '#7e929e' },
    ]}/>
    <Label value="INBOUND PLATE" at={[inbound[0], .92, -2.5]} tint="#d3edff" width={5.75}/>
    <Label value="OUTBOUND" at={[outbound[0], .92, outbound[2] + 1.9]} width={5.15}/>
    <Label value="AISLE HANDOFF" at={[handoff[0] - 1.1, .86, 1.75]} tint="#ecce97" width={5.7}/>
    {queue && animation?.plan.cargo.id !== queue.id && <>
      <mesh position={inbound}><boxGeometry args={cargoSize(queue.size)}/>
        <meshStandardMaterial color={cargoColor} roughness={.61}/></mesh>
      <Label value={queue.id} at={[inbound[0], inbound[1] + .43, inbound[2] + containerWidth / 2 + .12]} tint="#d2eeff" width={4.9}/>
    </>}
    {highlights.map((slot, index) => <lineSegments key={`${slot.id}-${index}`} geometry={boxEdges} renderOrder={1}
      position={point(slot)} scale={[columnPitch - .24, containerHeight + .22, rackDepth + .06]}>
      <lineBasicMaterial depthTest={slot.id !== target?.id} color={slot.id === target?.id ? targetColor : '#206ba2'} />
    </lineSegments>)}
    {target && !animation && <Label value={`${manualTarget ? 'CUSTOM' : 'AI'} · ${target.id}`}
      at={[target.x, target.y + .8, target.z + Math.sign(target.z) * (rackDepth / 2 + .42)]}
      tint="#f2f9ff" background={targetColor} width={manualTarget ? 5.8 : 4.3} />}
    {previewLegs.length > 0 && <Rails positions={[previewLegs[0].from, ...previewLegs.map((leg) => leg.to)]} color={targetColor} />}
    <StackerEquipment key={animation ? 'moving' : 'parked'} floor={state.floor} height={height}
      animation={animation} cargoColor={animatedColor} offline={state.operation.cranes === 0}/>

  </>
}

class WebGLBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function SlotMap({ state, selected, target, onSelect, manualTarget, busy, onRestrictSlot }: Props) {
  const inventory = occupied(state.floor)
  const selectedSlot = state.cells.find((cell) => cell.id === selected)
  return <div className="rack-map" aria-label="Two-dimensional storage map">
    <div className="rack-map-actions">
      <span role="status">{selectedSlot
        ? <><strong>{selectedSlot.id}</strong> · {selectedSlot.blocked ? 'Restricted' :
          inventory.has(selectedSlot.id) ? 'Occupied' : 'Open'}</>
        : 'Select a slot to manage access.'}</span>
      {selectedSlot && <button type="button" className="button subdued" disabled={busy}
        onClick={() => onRestrictSlot(selectedSlot.id, !selectedSlot.blocked)}>
        {selectedSlot.blocked ? 'Remove restriction' : 'Restrict slot'}
      </button>}
    </div>
    {(['A','B'] as const).map((rack) => {
      const cells = state.cells.filter((cell) => cell.rack === rack)
      const bays = Math.max(...cells.map((cell) => cell.bay), 1)
      return <div key={rack}><h3>Rack {rack}</h3>
        <div className="rack-grid" style={{ gridTemplateColumns: `repeat(${bays}, minmax(0, 1fr))` }}>
          {cells.sort((a,b) => b.level-a.level || a.bay-b.bay).map((slot) => {
            const item = inventory.get(slot.id)
            const status = slot.blocked ? 'Restricted' : item ? category(item.days) : 'Open'
            const description = [slot.id, status, item?.cargo.id].filter(Boolean).join(' · ')
            return <button type="button" key={slot.id} data-state={status} data-recommended={target?.id === slot.id} data-custom={manualTarget && target?.id === slot.id}
              aria-pressed={selected === slot.id} aria-label={description} title={description}
              onClick={() => onSelect(slot.id)}>{slot.id}<small>{slot.blocked ? status : item?.cargo.id.replace('JA-', '') ?? status}</small></button>
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
    <Canvas frameloop="demand" dpr={[1, 1.6]} camera={{ fov: 42, near: .2, far: 360 }}
      gl={{ antialias: true, alpha: false }} fallback={map}
      onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', () => {
        if (gl.domElement.isConnected) setWebGL(false)
      }, { once: true })}
      aria-label="Interactive high-bay storage digital twin">
      <Warehouse {...props} />
    </Canvas>
  </WebGLBoundary>
}
