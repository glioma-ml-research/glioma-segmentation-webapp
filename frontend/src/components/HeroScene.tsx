import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";

import { meshUrl } from "../lib/api";
import { regionName } from "../lib/regions";
import type { LabelInfo, Summary } from "../lib/types";
import { useGlbGeometry } from "./Scene3D";

/**
 * The landing page's hero: a sample case's own brain surface and regions.
 * The brain is drawn as a rim-lit shell so the regions inside stay visible,
 * an axial "scan plane" sweeps through it, the camera orbits slowly and leans
 * toward the pointer, and callout lines tie each region to its measured volume.
 * Same meshes and colours as the viewer; nothing here is decorative data.
 */

const CALLOUT_LEFT = 0.72; // labels' left edge, as a fraction of the scene width
const CALLOUT_TOP = 0.3;
const CALLOUT_STEP = 0.11;
const SHIFT = 0.05; // render the brain this fraction of the width left of centre, clear of the labels
/** Short enough for a callout. */
const SHORT_NAMES: Record<number, string> = { 1: "Non-enhancing core", 2: "Edema", 3: "Enhancing tumor", 4: "Resection cavity" };

const RIM_VERTEX = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-viewPosition.xyz);
  gl_Position = projectionMatrix * viewPosition;
}`;
const RIM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 2.4);
  gl_FragColor = vec4(uColor, 0.018 + rim * 0.62);
}`;
const SHEET_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SHEET_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 d = abs(vUv - 0.5) * 2.0;
  float body = 1.0 - smoothstep(0.35, 1.0, length(d));
  gl_FragColor = vec4(uColor, 0.085 * body);
}`;

interface Bounds {
  centre: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
}

export interface Callout {
  label: LabelInfo;
  ml: number;
  world: THREE.Vector3;
}

function BrainShell({ url }: { url: string }) {
  const geometry = useGlbGeometry(url);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: RIM_VERTEX,
        fragmentShader: RIM_FRAGMENT,
        uniforms: { uColor: { value: new THREE.Color("#b8d3e6") } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} renderOrder={10} />;
}

function Region({ url, label }: { url: string; label: LabelInfo }) {
  const geometry = useGlbGeometry(url);
  // Edema wraps the other regions; keep it see-through, as the viewer does.
  const translucent = label.value === 2;
  return (
    <mesh geometry={geometry} renderOrder={translucent ? 5 : 0}>
      <meshStandardMaterial
        color={label.color}
        emissive={label.color}
        emissiveIntensity={translucent ? 0.3 : 0.55}
        transparent={translucent}
        opacity={translucent ? 0.36 : 1}
        depthWrite={!translucent}
        roughness={0.45}
        metalness={0.05}
      />
    </mesh>
  );
}

/** A translucent axial sheet sweeping up and down through the brain: the slice plane. */
function ScanPlane({ bounds, moving }: { bounds: Bounds; moving: boolean }) {
  const mesh = useRef<THREE.Group>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHEET_VERTEX,
        fragmentShader: SHEET_FRAGMENT,
        uniforms: { uColor: { value: new THREE.Color("#00e5ff") } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const width = bounds.size.x * 1.15;
  const depth = bounds.size.y * 1.15;
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const phase = moving ? (Math.sin(clock.elapsedTime * 0.45) + 1) / 2 : 0.62;
    mesh.current.position.z = bounds.centre.z + (phase - 0.5) * bounds.size.z * 0.82;
  });
  return (
    <group ref={mesh} position={[bounds.centre.x, bounds.centre.y, bounds.centre.z]}>
      <mesh material={material} renderOrder={20}>
        <planeGeometry args={[width, depth]} />
      </mesh>
    </group>
  );
}

/** Slow orbit around the superior axis, leaning toward the pointer; the brain is rendered left of centre. */
function Rig({ bounds, moving, pointer }: { bounds: Bounds; moving: boolean; pointer: MutableRefObject<{ x: number; y: number }> }) {
  const { camera, size } = useThree();
  const azimuth = useRef(Math.atan2(1.35, 0.9)); // start anterior-right, as the viewer does
  const current = useRef<{ az: number; el: number } | null>(null);
  const light = useRef<THREE.DirectionalLight>(null);
  const distance = (bounds.radius / Math.sin(THREE.MathUtils.degToRad(13))) * 1.02;

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const shift = size.width < 700 ? 0 : SHIFT;
    perspective.setViewOffset(size.width, size.height, size.width * shift, 0, size.width, size.height);
    return () => perspective.clearViewOffset();
  }, [camera, size]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    if (moving) azimuth.current += step * 0.13;
    const target = { az: azimuth.current - pointer.current.x * 0.35, el: 0.3 + pointer.current.y * 0.18 };
    current.current ??= { ...target };
    const ease = 1 - Math.exp(-step * 3);
    current.current.az += (target.az - current.current.az) * ease;
    current.current.el += (target.el - current.current.el) * ease;
    const { az, el } = current.current;
    camera.position.set(
      bounds.centre.x + distance * Math.cos(el) * Math.cos(az),
      bounds.centre.y + distance * Math.cos(el) * Math.sin(az),
      bounds.centre.z + distance * Math.sin(el),
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(bounds.centre);
    light.current?.position.copy(camera.position);
  });

  return (
    <>
      <hemisphereLight args={["#ffffff", "#1d2430", 0.7]} />
      <directionalLight ref={light} intensity={1.6} />
    </>
  );
}

/** Moves the callout lines' inner ends onto the regions, every frame, without re-rendering React. */
function CalloutLines({ callouts, lines, dots }: { callouts: Callout[]; lines: MutableRefObject<(SVGLineElement | null)[]>; dots: MutableRefObject<(SVGCircleElement | null)[]> }) {
  const { camera, size } = useThree();
  const point = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    callouts.forEach((callout, index) => {
      point.copy(callout.world).project(camera);
      const x = ((point.x + 1) / 2) * size.width;
      const y = ((1 - point.y) / 2) * size.height;
      const line = lines.current[index];
      const dot = dots.current[index];
      if (line) {
        line.setAttribute("x1", String(size.width * CALLOUT_LEFT - 10));
        line.setAttribute("y1", String(size.height * (CALLOUT_TOP + index * CALLOUT_STEP) + 15));
        line.setAttribute("x2", String(x));
        line.setAttribute("y2", String(y));
      }
      dot?.setAttribute("cx", String(x));
      dot?.setAttribute("cy", String(y));
    });
  });
  return null;
}

function Loaded({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}

export default function HeroScene({ jobId, summary, onReady }: { jobId: string; summary: Summary; onReady: () => void }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const lines = useRef<(SVGLineElement | null)[]>([]);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const [onScreen, setOnScreen] = useState(true);
  const [ready, setReady] = useState(false);
  const moving = useMemo(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Draw only while the hero is on screen.
  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The camera leans toward the pointer anywhere on the page (fine pointers only; touch scrolls normally).
  useEffect(() => {
    if (!moving || !window.matchMedia("(pointer: fine)").matches) return;
    const onMove = (event: PointerEvent) => {
      pointer.current = { x: (event.clientX / window.innerWidth) * 2 - 1, y: (event.clientY / window.innerHeight) * 2 - 1 };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [moving]);

  const bounds = useMemo<Bounds>(() => {
    const box = summary.meshes.brain?.bounds_world_mm ?? { min: [-70, -90, -50], max: [70, 90, 70] };
    const min = new THREE.Vector3(...(box.min as [number, number, number]));
    const max = new THREE.Vector3(...(box.max as [number, number, number]));
    const size = max.clone().sub(min);
    return { centre: min.clone().add(max).multiplyScalar(0.5), size, radius: size.length() / 2 };
  }, [summary]);

  const regions = summary.label_map.filter((label) => label.value !== 0 && summary.meshes[`label_${label.value}`]);
  const callouts: Callout[] = useMemo(
    () =>
      summary.statistics.labels
        .filter((entry) => entry.voxels > 0 && summary.meshes[`label_${entry.value}`])
        .map((entry) => {
          const at = entry.components[0]?.centroid_world_mm ?? entry.centroid_world_mm;
          const label = summary.label_map.find((item) => item.value === entry.value)!;
          return at ? { label, ml: entry.volume_ml, world: new THREE.Vector3(at[0], at[1], at[2]) } : null;
        })
        .filter((value): value is Callout => value !== null),
    [summary],
  );

  const handleReady = () => {
    setReady(true);
    onReady();
  };

  return (
    <div ref={wrapper} className={`hero-scene${ready ? " is-ready" : ""}`}>
      <Canvas frameloop={!onScreen ? "never" : moving ? "always" : "demand"} camera={{ fov: 26, near: 1, far: 5000, up: [0, 0, 1] }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
        <Rig bounds={bounds} moving={moving} pointer={pointer} />
        <Suspense fallback={null}>
          {summary.meshes.brain && <BrainShell url={meshUrl(jobId, "brain")} />}
          {regions.map((label) => (
            <Region key={label.value} url={meshUrl(jobId, `label_${label.value}`)} label={label} />
          ))}
          <ScanPlane bounds={bounds} moving={moving} />
          <CalloutLines callouts={callouts} lines={lines} dots={dots} />
          <Loaded onReady={handleReady} />
        </Suspense>
      </Canvas>
      <svg className="callout-lines" aria-hidden="true">
        {callouts.map((callout, index) => (
          <g key={callout.label.value}>
            <line
              ref={(element) => {
                lines.current[index] = element;
              }}
            />
            <circle
              r="3.5"
              fill={callout.label.color}
              style={{ filter: `drop-shadow(0 0 6px ${callout.label.color})` }}
              ref={(element) => {
                dots.current[index] = element;
              }}
            />
          </g>
        ))}
      </svg>
      <ol className="callouts" aria-label="Regions in this sample case">
        {callouts.map((callout, index) => (
          <li key={callout.label.value} style={{ left: `${CALLOUT_LEFT * 100}%`, top: `${(CALLOUT_TOP + index * CALLOUT_STEP) * 100}%`, transitionDelay: `${200 + index * 120}ms` }}>
            <span className="swatch" style={{ background: callout.label.color, boxShadow: `0 0 10px ${callout.label.color}` }} />
            <span title={regionName(callout.label.value)}>{SHORT_NAMES[callout.label.value] ?? regionName(callout.label.value)}</span>
            <span className="mono">{callout.ml.toFixed(1)} mL</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
