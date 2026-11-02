// Kirish sahifasidagi 3D: (1) kiruvchining personaji — oltin podiumda turadi, kirishda sakrab xursand bo'ladi;
// (2) "Kirish" tugmasi ichida mashina — so'rov ketayotganda kirib keladi, muvaffaqiyatda o'tib ketadi, xatoda orqaga qaytadi.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildCar, buildGuard, poseGuard, driveCar, mat, mesh, lerp } from './three-kit';
import { paintFor } from './api';
import { CHARACTERS } from './characters';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Kichik three.js sahna: shaffof fon, o'lchamga moslashadi, faqat ko'rinib turganda chiziladi
function useStage(ref, setup) {
  useEffect(() => {
    const el = ref.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    const tick = setup(scene, camera);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      tick(dt, clock.elapsedTime);
      renderer.render(scene, camera);
    });
    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
    // setup bir marta — keyingi o'zgarishlar ref orqali o'qiladi
  }, []); // eslint-disable-line
}

function lights(scene, warm = 0xfff1d6) {
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2c30, 1.6));
  const key = new THREE.DirectionalLight(warm, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xf2c230, 1.4); // oltin kontur nur
  rim.position.set(-3, 3, -3);
  scene.add(rim);
}

// ---------- Personaj sahnasi ----------
const FACE = -1.0; // personaj kameraga qaragan (oldi +x, kamera yo'nalishi bo'yicha burilgan)
// mode: idle | cheer | sad. character — three-kit CHARACTERS dagi tavsif
export default function CharacterStage({ character: who, mode = 'idle' }) {
  const character = typeof who === 'string' ? CHARACTERS[who] : who; // 'boss' kabi kalit ham bo'ladi
  const mount = useRef(null);
  const state = useRef({ character, mode });
  useEffect(() => {
    state.current.mode = mode;
  }, [mode]);
  useEffect(() => {
    state.current.character = character;
  }, [character]);

  useStage(mount, (scene, camera) => {
    lights(scene);
    camera.position.set(1.95, 1.5, 3.2);
    camera.lookAt(0, 1.05, 0);
    // Oltin podium va halqa
    const podium = mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.12, 48), mat(0x2a2c30, { metalness: 0.5, roughness: 0.3 }), { y: 0.06 });
    const ring = mesh(new THREE.TorusGeometry(0.66, 0.025, 12, 64), mat(0xf2c230, { metalness: 0.9, roughness: 0.25, emissive: 0x8a6a10, emissiveIntensity: 0.4 }), { y: 0.12 });
    ring.rotation.x = Math.PI / 2;
    scene.add(podium, ring);

    let person = null;
    let shown = null;
    let swap = 0; // almashganda kichrayib-kattalashadi
    return (dt, time) => {
      const { character: c, mode: m } = state.current;
      if (c !== shown) {
        swap = 1;
        if (person) scene.remove(person);
        person = buildGuard(c);
        person.position.y = 0.12;
        person.rotation.y = FACE; // tomoshabinga qaragan
        scene.add(person);
        shown = c;
      }
      swap = Math.max(0, swap - dt * 3);
      const s = 1 - Math.sin(swap * Math.PI) * 0.25;
      person.scale.setScalar(s);
      person.rotation.y = FACE + (m === 'idle' ? Math.sin(time * 0.6) * 0.15 : 0);
      ring.rotation.z = time * 0.6;
      ring.material.emissiveIntensity = m === 'cheer' ? 1.2 + Math.sin(time * 12) * 0.6 : 0.4;
      poseGuard(person, reduced ? 'idle' : m, time, dt, null);
    };
  });

  return <div className="char-stage" ref={mount} aria-hidden="true" />;
}

// ---------- Tugma ichidagi mashina ----------
// phase: idle | driving (so'rov ketyapti) | done (kirdi) | fail (rad etildi)
export function ButtonCar({ phase, plate = 'AVTOSTOYANKA' }) {
  const mount = useRef(null);
  const ph = useRef(phase);
  useEffect(() => {
    ph.current = phase;
  }, [phase]);

  useStage(mount, (scene, camera) => {
    lights(scene);
    camera.position.set(0, 1.2, 5.2);
    camera.lookAt(0, 0.45, 0);
    // yo'l chizig'i va shlagbaum ustuni
    for (let x = -6; x < 6; x += 1.1) scene.add(mesh(new THREE.BoxGeometry(0.55, 0.01, 0.06), mat(0xf2c230), { x, y: 0, z: 0.6, shadow: false }));
    const car = buildCar();
    car.userData.paint.color.set(paintFor(plate));
    car.userData.setPlate(plate.slice(0, 8));
    car.scale.setScalar(0.85);
    scene.add(car);
    let x = -7;
    return (dt) => {
      const p = ph.current;
      // maqsad: kutish — tugmadan tashqarida; yurish — markazga kelib to'xtaydi; tayyor — o'ngdan chiqib ketadi; xato — orqaga qaytadi
      const target = p === 'driving' ? 0 : p === 'done' ? 9 : -7;
      const speed = p === 'done' ? 6 : p === 'fail' ? 4 : 3.2;
      x = reduced ? target : lerp(x, target, 1 - Math.exp(-dt * speed * 0.6));
      if (p === 'driving' && Math.abs(x) < 0.05) x += Math.sin(performance.now() / 70) * 0.004; // dvigatel titraydi
      car.visible = x > -6.5 && x < 8.5;
      driveCar(car, x, 0, dt);
    };
  });

  return <span className="btn-car" ref={mount} aria-hidden="true" />;
}
