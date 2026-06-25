'use client';

import { Text } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Mesh, MeshBasicMaterial } from 'three';

type Pulse = {
  id: number;
  startedAt: number;
};

const tracePath = [
  [-3.38, -0.78, 0.08],
  [-3.38, 1.02, 0.08],
  [-2.12, 1.02, 0.08],
  [-3.38, 0.18, 0.08],
  [-2.34, 0.18, 0.08],
  [-1.56, -0.78, 0.08],
  [-1.18, 1.02, 0.08],
  [-0.48, -0.42, 0.08],
  [0.23, 1.02, 0.08],
  [0.62, -0.78, 0.08],
  [1.48, 0.86, 0.08],
  [2.64, 1.02, 0.08],
  [1.48, 0.86, 0.08],
  [1.36, -0.46, 0.08],
  [2.62, -0.72, 0.08],
] as const;

export function PortalScene({ online }: { online: boolean }) {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const nextPulse = useRef(0);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);

    function updatePreference() {
      setReducedMotion(query.matches);
    }

    query.addEventListener('change', updatePreference);
    return () => query.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    function addPulse() {
      const id = nextPulse.current;
      nextPulse.current += 1;
      setPulses((current) => [...current.slice(-7), { id, startedAt: performance.now() }]);
      window.setTimeout(() => {
        setPulses((current) => current.filter((pulse) => pulse.id !== id));
      }, 1400);
    }

    window.addEventListener('pointerdown', addPulse);
    return () => window.removeEventListener('pointerdown', addPulse);
  }, [reducedMotion]);

  return (
    <Canvas
      camera={{ position: [0, 0, 7.5], fov: 42 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      dpr={[1, 1.5]}
    >
      <ambientLight intensity={1.05} />
      <directionalLight position={[3.4, 4.2, 4]} intensity={1.5} color="#dbeafe" />
      <pointLight position={[-3.8, -2.1, 2.4]} intensity={1.9} color="#ff3f5f" />
      <pointLight position={[4.2, 1.8, 2.8]} intensity={2.05} color="#2777ff" />
      <FmcMark online={online} pulses={pulses} reducedMotion={reducedMotion} />
    </Canvas>
  );
}

function FmcMark({ online, pulses, reducedMotion }: { online: boolean; pulses: Pulse[]; reducedMotion: boolean }) {
  const groupRef = useRef<Group>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    function move(event: PointerEvent) {
      pointer.current = {
        x: event.clientX / window.innerWidth - 0.5,
        y: event.clientY / window.innerHeight - 0.5,
      };
    }

    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [reducedMotion]);

  useFrame((_state, delta) => {
    if (reducedMotion) {
      return;
    }

    const group = groupRef.current;
    if (!group) {
      return;
    }

    const lift = online ? 0.08 : -0.04;
    group.rotation.y += (pointer.current.x * 0.16 - group.rotation.y) * delta * 3.4;
    group.rotation.x += (-pointer.current.y * 0.08 - group.rotation.x) * delta * 3.4;
    group.position.x += (pointer.current.x * 0.32 - group.position.x) * delta * 2.4;
    group.position.y += (lift - pointer.current.y * 0.14 - group.position.y) * delta * 2.4;
  });

  return (
    <group ref={groupRef} position={[0.45, 0, -2.25]} rotation={[0, -0.12, 0]}>
      <Text
        anchorX="center"
        anchorY="middle"
        fontSize={2.65}
        letterSpacing={-0.065}
        position={[0, 0.08, 0]}
      >
        FMC
        <meshStandardMaterial
          color={online ? '#d7dce6' : '#778294'}
          emissive={online ? '#151b29' : '#070a10'}
          metalness={0.18}
          roughness={0.34}
        />
      </Text>
      <Text
        anchorX="center"
        anchorY="middle"
        fontSize={0.28}
        letterSpacing={0.18}
        position={[0.02, -1.55, 0.06]}
      >
        FRACTURE MC
        <meshBasicMaterial color={online ? '#8fb7ff' : '#64748b'} transparent opacity={0.72} />
      </Text>
      <LogoSkeleton online={online} />
      {pulses.map((pulse) => (
        <TracePulse key={pulse.id} startedAt={pulse.startedAt} />
      ))}
    </group>
  );
}

function LogoSkeleton({ online }: { online: boolean }) {
  const segments = useMemo(() => toSegments(tracePath), []);

  return (
    <group position={[0, 0.04, 0.14]}>
      {segments.map((segment, index) => (
        <StaticSegment
          key={`${segment.start.join(':')}-${index}`}
          start={segment.start}
          end={segment.end}
          online={online}
        />
      ))}
    </group>
  );
}

function StaticSegment({ start, end, online }: { start: Point; end: Point; online: boolean }) {
  const segment = useMemo(() => segmentMetrics(start, end), [end, start]);

  return (
    <mesh position={segment.center} rotation={[0, 0, segment.angle]} scale={[segment.length, 1, 1]}>
      <boxGeometry args={[1, 0.012, 0.012]} />
      <meshBasicMaterial color={online ? '#f8fafc' : '#a5adbb'} transparent opacity={online ? 0.18 : 0.1} />
    </mesh>
  );
}

function TracePulse({ startedAt }: { startedAt: number }) {
  const segments = useMemo(() => toSegments(tracePath), []);

  return (
    <group position={[0, 0.04, 0.2]}>
      {segments.map((segment, index) => (
        <TraceSegment
          key={`${startedAt}-${index}`}
          start={segment.start}
          end={segment.end}
          index={index}
          startedAt={startedAt}
        />
      ))}
    </group>
  );
}

function TraceSegment({ start, end, index, startedAt }: { start: Point; end: Point; index: number; startedAt: number }) {
  const meshRef = useRef<Mesh>(null);
  const materialRef = useRef<MeshBasicMaterial>(null);
  const segment = useMemo(() => segmentMetrics(start, end), [end, start]);

  useFrame(() => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) {
      return;
    }

    const elapsed = (performance.now() - startedAt) / 1000 - index * 0.025;
    const progress = clamp(elapsed / 0.18, 0, 1);
    const fade = clamp(1 - (elapsed - 0.2) / 0.62, 0, 1);
    mesh.scale.x = segment.length * progress;
    mesh.position.set(
      start[0] + segment.direction[0] * segment.length * progress * 0.5,
      start[1] + segment.direction[1] * segment.length * progress * 0.5,
      start[2] + segment.direction[2] * segment.length * progress * 0.5,
    );
    material.opacity = progress <= 0 ? 0 : 0.58 * fade;
  });

  return (
    <mesh ref={meshRef} rotation={[0, 0, segment.angle]}>
      <boxGeometry args={[1, 0.026, 0.026]} />
      <meshBasicMaterial ref={materialRef} color="#ffffff" transparent opacity={0} />
    </mesh>
  );
}

type Point = readonly [number, number, number];

function toSegments(points: readonly Point[]) {
  return points.slice(0, -1).map((start, index) => ({ start, end: points[index + 1] }));
}

function segmentMetrics(start: Point, end: Point) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return {
    angle: Math.atan2(dy, dx),
    center: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2] as [number, number, number],
    direction: [dx / length, dy / length, dz / length] as [number, number, number],
    length,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
