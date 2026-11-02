// 3D kirish darvozasi: shlagbaum ko'tariladi, mashina kirib (yoki chiqib) ketadi.
// Faqat animatsiya paytida render qilinadi — bo'sh turganda protsessorni band qilmaydi.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { paintFor } from './api';

const ASPHALT = 0x2b2e33;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

function buildCar() {
  const car = new THREE.Group();
  const body = box(2.2, 0.55, 1.05, 0xffffff, { roughness: 0.35, metalness: 0.4 });
  body.position.y = 0.45;
  const cabin = box(1.2, 0.45, 0.95, 0x1b2430, { roughness: 0.1, metalness: 0.6 });
  cabin.position.set(-0.1, 0.95, 0);
  car.add(body, cabin);
  for (const [x, z] of [[0.7, 0.5], [-0.7, 0.5], [0.7, -0.5], [-0.7, -0.5]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.24, z);
    car.add(w);
  }
  for (const z of [0.32, -0.32]) {
    const head = box(0.05, 0.12, 0.22, 0xfff3c4, { emissive: 0xfff3c4, emissiveIntensity: 1.2 });
    head.position.set(1.1, 0.5, z);
    const tail = box(0.05, 0.1, 0.22, 0xe5484d, { emissive: 0xe5484d, emissiveIntensity: 1 });
    tail.position.set(-1.1, 0.5, z);
    car.add(head, tail);
  }
  car.userData.body = body;
  return car;
}

export default function Gate3D({ event }) {
  const mount = useRef(null);
  const scene3d = useRef(null);

  // Sahnani bir marta quramiz
  useEffect(() => {
    const el = mount.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(ASPHALT);
    scene.fog = new THREE.Fog(ASPHALT, 14, 26);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(5.5, 5, 8.5);
    camera.lookAt(0, 0.4, 0);

    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2b2e33, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(4, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    // Yer, yo'l chiziqlari, to'xtash chizig'i
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: ASPHALT, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    for (let x = -14; x < 14; x += 2.4) {
      const dash = box(1.2, 0.01, 0.12, 0xf2c230);
      dash.position.set(x, 0.01, 0);
      dash.castShadow = false;
      scene.add(dash);
    }
    for (const z of [-2.1, 2.1]) {
      const edge = box(30, 0.01, 0.08, 0xeceae4);
      edge.position.set(0, 0.01, z);
      scene.add(edge);
    }
    const stop = box(0.25, 0.01, 4, 0xeceae4);
    stop.position.set(-1.3, 0.011, 0);
    scene.add(stop);

    // Qorovul budkasi va "P" belgisi
    const booth = box(1.4, 1.8, 1.4, 0xd9d6cf);
    booth.position.set(0.4, 0.9, -3.3);
    const roof = box(1.7, 0.15, 1.7, 0x2257d6);
    roof.position.set(0.4, 1.88, -3.3);
    const glass = box(0.02, 0.7, 1, 0x9fc3ff, { roughness: 0.05, metalness: 0.3 });
    glass.position.set(1.11, 1.2, -3.3);
    const signPole = box(0.08, 2.6, 0.08, 0x8a8f96);
    signPole.position.set(-2.4, 1.3, -2.8);
    const sign = box(0.9, 0.9, 0.06, 0x2257d6);
    sign.position.set(-2.4, 2.7, -2.8);
    scene.add(booth, roof, glass, signPole, sign);

    // Shlagbaum: ustun + qizil-oq qanot (ustun tepasida aylanadi)
    const post = box(0.35, 1.1, 0.35, 0xf2c230);
    post.position.set(0, 0.55, -2.4);
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.0, -2.4);
    for (let i = 0; i < 8; i++) {
      const seg = box(0.12, 0.12, 0.55, i % 2 ? 0xffffff : 0xe5484d);
      seg.position.z = 0.3 + i * 0.55;
      pivot.add(seg);
    }
    scene.add(post, pivot);

    const car = buildCar();
    car.visible = false;
    scene.add(car);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    scene3d.current = { renderer, scene, camera, car, pivot, raf: 0 };
    return () => {
      cancelAnimationFrame(scene3d.current.raf);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // Har yangi kirish/chiqish voqeasida animatsiya
  useEffect(() => {
    const s = scene3d.current;
    if (!s || !event) return;
    const { renderer, scene, camera, car, pivot } = s;
    const out = event.type === 'exit';
    car.userData.body.material.color.set(paintFor(event.plate));
    car.visible = true;
    car.rotation.y = out ? Math.PI : 0;
    // Kirish: chapdan o'ngga. Chiqish: o'ngdan chapga.
    const [from, stopAt, to] = out ? [10, 1.6, -12] : [-12, -2.6, 10];
    const z = out ? 0.9 : -0.9;

    const frame = (t) => {
      const drive1 = ease(clamp01(t / 1.1));
      const lift = ease(clamp01((t - 1.0) / 0.6)) - ease(clamp01((t - 3.0) / 0.6));
      const drive2 = clamp01((t - 1.6) / 1.4) ** 1.6;
      car.position.set(t < 1.6 ? from + (stopAt - from) * drive1 : stopAt + (to - stopAt) * drive2, 0, z);
      pivot.rotation.x = -lift * (Math.PI / 2.1);
      renderer.render(scene, camera);
    };

    cancelAnimationFrame(s.raf);
    if (reduced()) {
      car.visible = false;
      frame(0);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = (now - start) / 1000;
      frame(t);
      if (t < 3.7) s.raf = requestAnimationFrame(tick);
      else {
        car.visible = false;
        renderer.render(scene, camera);
      }
    };
    s.raf = requestAnimationFrame(tick);
  }, [event]);

  return (
    <div className="gate">
      <div className="gate-canvas" ref={mount} />
      {event && (
        <div className={`gate-caption ${event.type}`} key={event.at}>
          <span className="plate">{event.plate}</span>
          <span>{event.type === 'exit' ? `${event.label} joyidan chiqdi` : `${event.label} joyiga kirdi`}</span>
        </div>
      )}
    </div>
  );
}
