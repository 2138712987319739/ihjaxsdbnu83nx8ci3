'use client';

import { Float, Stars } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { gsap } from 'gsap';
import { useEffect, useRef } from 'react';
import type { Mesh } from 'three';

export function PortalScene({ online }: { online: boolean }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 7], fov: 48 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      dpr={[1, 1.5]}
    >
      <ambientLight intensity={0.72} />
      <pointLight position={[4, 3, 3]} intensity={1.8} color="#2777ff" />
      <pointLight position={[-4, -3, 2]} intensity={1.25} color="#ff3f5f" />
      <Stars radius={48} depth={18} count={900} factor={3.2} saturation={0.8} fade speed={0.4} />
      <Float speed={1.4} rotationIntensity={0.35} floatIntensity={0.6}>
        <PortalCore online={online} />
      </Float>
    </Canvas>
  );
}

function PortalCore({ online }: { online: boolean }) {
  const meshRef = useRef<Mesh>(null);
  const ringRef = useRef<Mesh>(null);

  useEffect(() => {
    if (!meshRef.current) {
      return;
    }

    gsap.to(meshRef.current.scale, {
      x: online ? 1.18 : 0.95,
      y: online ? 1.18 : 0.95,
      z: online ? 1.18 : 0.95,
      duration: 0.55,
      ease: 'power2.out',
    });
  }, [online]);

  useFrame((_state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.12;
      meshRef.current.rotation.y += delta * 0.18;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 0.16;
    }
  });

  return (
    <group position={[3.8, 0.2, -1.5]}>
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1.28, 1]} />
        <meshStandardMaterial color={online ? '#2777ff' : '#334155'} emissive={online ? '#174ea6' : '#111827'} roughness={0.38} metalness={0.22} wireframe />
      </mesh>
      <mesh ref={ringRef}>
        <torusGeometry args={[2.1, 0.025, 12, 96]} />
        <meshStandardMaterial color="#ff3f5f" emissive="#7f1d1d" />
      </mesh>
    </group>
  );
}
