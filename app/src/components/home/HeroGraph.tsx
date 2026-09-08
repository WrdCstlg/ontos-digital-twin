import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const MODULE_COLORS = ['#FB7185', '#A78BFA', '#34D399', '#FBBF24', '#38BDF8'];
const NODE_COUNT = 180;
const EDGE_COUNT = 260;

interface GraphData {
  positions: Float32Array;
  colors: Float32Array;
  baseColors: Float32Array;
  edgePositions: Float32Array;
  edgeColors: Float32Array;
  edgePairs: Array<[number, number]>;
  phases: Float32Array;
}

function buildGraph(): GraphData {
  const positions = new Float32Array(NODE_COUNT * 3);
  const colors = new Float32Array(NODE_COUNT * 3);
  const baseColors = new Float32Array(NODE_COUNT * 3);
  const phases = new Float32Array(NODE_COUNT);
  const palette = MODULE_COLORS.map((c) => new THREE.Color(c));

  for (let i = 0; i < NODE_COUNT; i++) {
    // Loose cluster cloud, denser near center
    const r = Math.pow(Math.random(), 0.6) * 10;
    const theta = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 9;
    positions[i * 3] = Math.cos(theta) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(theta) * r;
    const c = palette[i % palette.length];
    baseColors[i * 3] = c.r;
    baseColors[i * 3 + 1] = c.g;
    baseColors[i * 3 + 2] = c.b;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const edgePairs: Array<[number, number]> = [];
  const used = new Set<string>();
  let guard = 0;
  while (edgePairs.length < EDGE_COUNT && guard++ < EDGE_COUNT * 30) {
    const a = Math.floor(Math.random() * NODE_COUNT);
    const b = Math.floor(Math.random() * NODE_COUNT);
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (used.has(key)) continue;
    const dx = positions[a * 3] - positions[b * 3];
    const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
    const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
    if (dx * dx + dy * dy + dz * dz > 30) continue;
    used.add(key);
    edgePairs.push([a, b]);
  }

  const edgePositions = new Float32Array(edgePairs.length * 6);
  const edgeColors = new Float32Array(edgePairs.length * 6);
  const dim = new THREE.Color('#334155');
  edgePairs.forEach(([a, b], i) => {
    for (let k = 0; k < 3; k++) {
      edgePositions[i * 6 + k] = positions[a * 3 + k];
      edgePositions[i * 6 + 3 + k] = positions[b * 3 + k];
      edgeColors[i * 6 + k] = dim.r * 0.7;
      edgeColors[i * 6 + 1 + k] = dim.g * 0.7;
      edgeColors[i * 6 + 2 + k] = dim.b * 0.7;
      edgeColors[i * 6 + 3 + k] = dim.r * 0.7;
      edgeColors[i * 6 + 4 + k] = dim.g * 0.7;
      edgeColors[i * 6 + 5 + k] = dim.b * 0.7;
    }
  });

  return { positions, colors, baseColors, edgePositions, edgeColors, edgePairs, phases };
}

/** Soft circular sprite for the points */
function makeSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function Constellation() {
  const group = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const data = useMemo(() => buildGraph(), []);
  const sprite = useMemo(() => makeSprite(), []);
  const iris = useMemo(() => new THREE.Color('#818CF8'), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const { pointer } = useThree();
  const world = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      // slow auto-orbit, ~0.02 rad/s plus a gentle pointer parallax
      group.current.rotation.y += delta * 0.02;
      group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, pointer.y * 0.08, 0.03);
    }

    // project pointer into the group's local plane for proximity glow
    const pts = pointsRef.current;
    const lns = linesRef.current;
    if (!pts || !lns || !group.current) return;

    world.current.set(pointer.x * 14, pointer.y * 9, 0);
    group.current.worldToLocal(world.current);

    const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
    const col = pts.geometry.attributes.color as THREE.BufferAttribute;
    const near: boolean[] = new Array(NODE_COUNT).fill(false);
    const threshold = 2.6; // ~60px of cursor at this camera distance
    for (let i = 0; i < NODE_COUNT; i++) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const d = tmp.distanceTo(world.current);
      const pulse = 0.82 + Math.sin(t * 1.4 + data.phases[i]) * 0.12;
      const boost = d < threshold ? 1.6 : 1;
      near[i] = d < threshold;
      col.setXYZ(
        i,
        Math.min(1, data.baseColors[i * 3] * pulse * boost),
        Math.min(1, data.baseColors[i * 3 + 1] * pulse * boost),
        Math.min(1, data.baseColors[i * 3 + 2] * pulse * boost),
      );
    }
    col.needsUpdate = true;

    // illuminate edges near the cursor with iris
    const lcol = lns.geometry.attributes.color as THREE.BufferAttribute;
    const dimR = 0.2 * 0.7;
    const dimG = 0.32 * 0.7;
    const dimB = 0.41 * 0.7;
    data.edgePairs.forEach(([a, b], i) => {
      const hot = near[a] || near[b];
      for (const v of [0, 1]) {
        const base = i * 6 + v * 3;
        if (hot) {
          lcol.array[base] = iris.r;
          lcol.array[base + 1] = iris.g;
          lcol.array[base + 2] = iris.b;
        } else {
          lcol.array[base] = dimR;
          lcol.array[base + 1] = dimG;
          lcol.array[base + 2] = dimB;
        }
      }
    });
    lcol.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.22}
          map={sprite}
          vertexColors
          transparent
          opacity={0.95}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.edgePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[data.edgeColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

/**
 * HeroGraph — slowly rotating knowledge-graph constellation over bg-void:
 * ~180 glowing module-colored nodes, ~260 hairline edges, cursor proximity
 * brightening, fog into the void.
 */
export default function HeroGraph() {
  return (
    <Canvas
      camera={{ position: [0, 0, 16], fov: 55 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <fog attach="fog" args={['#070B14', 12, 26]} />
      <Constellation />
    </Canvas>
  );
}
