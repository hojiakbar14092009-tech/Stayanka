// 3D kirish darvozasi. Voqealar navbat bilan o'ynaladi: kelish (kamera raqamni o'qiydi), kirish, chiqish, haydab chiqarish.
// Qorovul doim "tirik": nafas oladi, atrofga qaraydi; mashinaga qo'l ko'taradi yoki to'lamaganni haydaydi.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { paintFor } from './api';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
// Burchakni eng qisqa yo'l bilan yaqinlashtirish
const lerpAngle = (a, b, t) => a + (((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * t;
// "Shifrlangan" so'kinishlar — tsenzura belgilarida
const GRAWLIX = ['#@$%&!', '%&*#@!!', '$#!%@?!', '@#&%$!!', '*%$#@&!'];

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });
function mesh(geo, material, { x = 0, y = 0, z = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, material, pos) => mesh(new THREE.BoxGeometry(w, h, d), material, pos);

// Davlat raqami teksturasi: oq plastinka, chapda hudud kodi
function drawPlate(ctx, plate) {
  const { width: w, height: h } = ctx.canvas;
  ctx.fillStyle = '#f4f3ef';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.beginPath();
  ctx.moveTo(124, 10);
  ctx.lineTo(124, h - 10);
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = 'bold 80px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(plate.slice(0, 2), 66, h / 2 + 4);
  ctx.font = 'bold 86px Arial';
  ctx.fillText(plate.slice(2), (w + 124) / 2, h / 2 + 4);
}

// ---------- Mashina: yon profil siqib chiqariladi (extrude), g'ildiraklar aylanadi ----------
function buildCar() {
  const car = new THREE.Group();
  const body = new THREE.Group(); // osma: burun egilishi shu guruhda
  car.add(body);
  const paint = mat(0xffffff, { roughness: 0.28, metalness: 0.55 });
  const glass = mat(0x18202b, { roughness: 0.08, metalness: 0.7 });

  const lower = new THREE.Shape();
  lower.moveTo(-1.12, 0.24);
  lower.lineTo(1.08, 0.24);
  lower.quadraticCurveTo(1.18, 0.26, 1.17, 0.42);
  lower.lineTo(1.12, 0.56);
  lower.quadraticCurveTo(0.9, 0.64, 0.55, 0.64);
  lower.lineTo(-0.95, 0.66);
  lower.quadraticCurveTo(-1.12, 0.64, -1.13, 0.5);
  lower.closePath();
  const lowerGeo = new THREE.ExtrudeGeometry(lower, { depth: 0.96, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 3 });
  lowerGeo.translate(0, 0, -0.48);
  body.add(mesh(lowerGeo, paint));

  const cabin = new THREE.Shape();
  cabin.moveTo(0.56, 0.63);
  cabin.quadraticCurveTo(0.3, 0.9, 0.12, 0.97);
  cabin.lineTo(-0.5, 0.97);
  cabin.quadraticCurveTo(-0.78, 0.9, -0.93, 0.64);
  cabin.closePath();
  const cabinGeo = new THREE.ExtrudeGeometry(cabin, { depth: 0.84, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  cabinGeo.translate(0, 0, -0.42);
  body.add(mesh(cabinGeo, glass));
  body.add(box(0.64, 0.04, 0.86, paint, { x: -0.19, y: 0.99 })); // tom
  body.add(box(0.06, 0.32, 0.88, paint, { x: -0.16, y: 0.82 })); // B-ustun

  const head = mat(0xfff3c4, { emissive: 0xfff3c4, emissiveIntensity: 1.4 });
  const tail = mat(0x8a1c20, { emissive: 0xe5484d, emissiveIntensity: 0.4 });
  for (const z of [0.33, -0.33]) {
    body.add(box(0.04, 0.09, 0.22, head, { x: 1.16, y: 0.48, z, shadow: false }));
    body.add(box(0.04, 0.09, 0.24, tail, { x: -1.15, y: 0.55, z, shadow: false }));
  }
  for (const z of [0.55, -0.55]) {
    const mirror = box(0.1, 0.07, 0.1, paint, { x: 0.45, y: 0.68, z });
    mirror.add(box(0.02, 0.05, 0.07, glass, { x: -0.05 }));
    body.add(mirror);
    body.add(box(0.6, 0.012, 0.005, mat(0x111111), { x: -0.05, y: 0.46, z: z * 0.9, shadow: false })); // eshik chizig'i
    body.add(box(0.005, 0.3, 0.005, mat(0x111111), { x: -0.16, y: 0.47, z: z * 0.9, shadow: false }));
  }
  body.add(box(0.03, 0.08, 0.5, mat(0x15171a, { metalness: 0.6, roughness: 0.3 }), { x: 1.17, y: 0.48, shadow: false })); // panjara
  body.add(box(0.03, 0.04, 0.96, mat(0x2a2c30), { x: 1.18, y: 0.27, shadow: false })); // bamper

  // Old va orqa raqam — bitta tekstura
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const plateTex = new THREE.CanvasTexture(canvas);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  plateTex.anisotropy = 4;
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, emissiveMap: plateTex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.4 });
  const front = mesh(new THREE.PlaneGeometry(0.42, 0.092), plateMat, { x: 1.2, y: 0.33, shadow: false });
  front.rotation.y = Math.PI / 2;
  const back = mesh(new THREE.PlaneGeometry(0.42, 0.092), plateMat, { x: -1.18, y: 0.37, shadow: false });
  back.rotation.y = -Math.PI / 2;
  body.add(front, back);

  const wheels = [];
  const tire = mat(0x141414, { roughness: 0.9 });
  const rim = mat(0xb9bcc2, { roughness: 0.3, metalness: 0.8 });
  for (const [x, z] of [[0.72, 0.47], [-0.72, 0.47], [0.72, -0.47], [-0.72, -0.47]]) {
    const w = new THREE.Group();
    w.position.set(x, 0.24, z);
    const t = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.2, 24), tire);
    t.rotation.x = Math.PI / 2;
    const r = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.21, 6), rim, { shadow: false });
    r.rotation.x = Math.PI / 2;
    w.add(t, r);
    car.add(w);
    wheels.push(w);
  }
  const setPlate = (plate) => {
    drawPlate(canvas.getContext('2d'), plate);
    plateTex.needsUpdate = true;
  };
  car.userData = { body, paint, tail, wheels, setPlate, v: 0, a: 0, lastX: null };
  return car;
}

// ---------- Qorovul: tizza va tirsakli skelet, yumaloq (kapsula) a'zolar, yuz ----------
const capsule = (r, len, material, pos) => mesh(new THREE.CapsuleGeometry(r, len, 6, 14), material, pos);

function buildGuard() {
  const g = new THREE.Group();
  const skin = mat(0xe8b98f, { roughness: 0.6 });
  const uniform = mat(0x24448f, { roughness: 0.8 });
  const pants = mat(0x232a38, { roughness: 0.85 });
  const dark = mat(0x111111, { roughness: 0.5 });
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  g.add(hips);
  const pelvis = capsule(0.13, 0.22, pants, { y: 0.02 });
  pelvis.rotation.x = Math.PI / 2;
  hips.add(pelvis);

  // Oyoq: son (hip) → tizza → boldir → poyabzal
  const legs = [-0.1, 0.1].map((z) => {
    const thigh = new THREE.Group();
    thigh.position.z = z;
    thigh.add(capsule(0.075, 0.3, pants, { y: -0.21 }));
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    knee.add(capsule(0.065, 0.3, pants, { y: -0.2 }));
    const shoe = box(0.25, 0.08, 0.13, dark, { x: 0.05, y: -0.43 });
    knee.add(shoe);
    thigh.add(knee);
    hips.add(thigh);
    return { thigh, knee };
  });

  const torso = new THREE.Group();
  torso.position.y = 0.06;
  hips.add(torso);
  const chest = capsule(0.17, 0.32, uniform, { y: 0.36 });
  chest.scale.set(0.85, 1, 1.4);
  torso.add(chest);
  const vest = mat(0xf2c230, { emissive: 0xf2c230, emissiveIntensity: 0.25, roughness: 0.6 });
  const strip = mat(0xdfe3ea, { emissive: 0xdfe3ea, emissiveIntensity: 0.35 });
  const band = (y, m, h) => {
    const b = mesh(new THREE.CylinderGeometry(1, 1, h, 24, 1, true), m, { y });
    b.scale.set(0.155, 1, 0.245);
    torso.add(b);
  };
  band(0.42, vest, 0.1);
  band(0.31, strip, 0.05);
  band(0.08, dark, 0.05); // kamar
  torso.add(box(0.03, 0.05, 0.06, mat(0xd9b44a, { metalness: 0.8, roughness: 0.3 }), { x: 0.15, y: 0.08 })); // to'qa
  torso.add(box(0.02, 0.07, 0.06, mat(0xd9b44a, { metalness: 0.8, roughness: 0.3 }), { x: 0.15, y: 0.5, z: -0.09 })); // nishon

  const neck = new THREE.Group();
  neck.position.y = 0.66;
  torso.add(neck);
  neck.add(mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 12), skin, { y: 0.03 }));
  const head = new THREE.Group();
  head.position.y = 0.2;
  neck.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.14, 24, 18), skin);
  skull.scale.set(1, 1.12, 0.95);
  head.add(skull);
  const eyes = [-0.05, 0.05].map((z) => {
    const e = mesh(new THREE.SphereGeometry(0.018, 10, 8), dark, { x: 0.125, y: 0.025, z, shadow: false });
    head.add(e);
    return e;
  });
  for (const z of [-0.05, 0.05]) head.add(box(0.02, 0.012, 0.05, mat(0x3a2a20), { x: 0.13, y: 0.065, z, shadow: false })); // qosh
  head.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), skin, { x: 0.145, y: -0.01 })); // burun
  head.add(box(0.025, 0.02, 0.09, mat(0x3a2a20), { x: 0.135, y: -0.05, shadow: false })); // mo'ylov
  head.add(mesh(new THREE.CylinderGeometry(0.15, 0.155, 0.08, 24), mat(0x1b2a55), { y: 0.12 }));
  head.add(mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.02, 24), mat(0x0f1733), { y: 0.085 }));
  const visor = box(0.14, 0.015, 0.24, dark, { x: 0.15, y: 0.09 });
  visor.rotation.z = -0.2;
  head.add(visor);
  head.add(box(0.012, 0.04, 0.05, mat(0xd9b44a, { metalness: 0.8 }), { x: 0.155, y: 0.13 })); // kokarda

  // Qo'l: yelka → tirsak → kaft
  const arms = [-0.25, 0.25].map((z) => {
    const upper = new THREE.Group();
    upper.position.set(0, 0.56, z);
    upper.add(capsule(0.058, 0.22, uniform, { y: -0.15 }));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    elbow.add(capsule(0.05, 0.2, uniform, { y: -0.12 }));
    elbow.add(mesh(new THREE.SphereGeometry(0.05, 12, 10), skin, { y: -0.29 }));
    upper.add(elbow);
    torso.add(upper);
    return { upper, elbow };
  });

  g.userData = { hips, torso, neck, head, legs, arms, eyes, walk: 0, blink: 2 };
  return g;
}

// Holat bo'yicha qorovul pozasi. mode: idle | walk | wave | shout. Har bo'g'in yumshoq yaqinlashadi.
function poseGuard(guard, mode, time, dt, lookAt) {
  const u = guard.userData;
  const k = Math.min(1, dt * 8);
  const T = { th: [0, 0], kn: [0.05, 0.05], up: [[0, 0.08], [0, -0.08]], el: [[0.15, 0], [0.15, 0]], lean: 0, twist: 0, bob: 0, sway: 0 };
  if (mode === 'walk') {
    u.walk += dt * 8.5;
    const p = u.walk;
    for (const [i, ph] of [[0, p], [1, p + Math.PI]]) {
      T.th[i] = Math.sin(ph) * 0.5;
      T.kn[i] = 0.1 + Math.max(0, Math.sin(ph + 1.4)) * 0.75; // tizza oldinga qadamda bukiladi
      T.up[i] = [-Math.sin(ph) * 0.42, (i ? -1 : 1) * 0.08];
      T.el[i] = [0.25 + Math.max(0, -Math.sin(ph)) * 0.35, 0];
    }
    T.bob = Math.abs(Math.cos(p)) * 0.035;
    T.twist = Math.sin(p) * 0.1;
    T.lean = 0.05;
  } else if (mode === 'wave') {
    T.up[1] = [0.2, -2.55]; // o'ng qo'l yon tomondan tepaga
    T.el[1] = [0, -0.35 + Math.sin(time * 9) * 0.45];
    T.up[0] = [0.05, 0.1];
    T.sway = 0.02;
  } else if (mode === 'shout') {
    T.up[1] = [2.0, -0.25]; // musht oldinga-tepaga
    T.el[1] = [0.9 + Math.sin(time * 20) * 0.35, 0];
    T.up[0] = [-0.35, 0.55]; // chap qo'l belda
    T.el[0] = [1.7, 0];
    T.lean = 0.2 + Math.sin(time * 10) * 0.04;
    T.th = [0.25, -0.1];
    T.kn = [0.3, 0.1];
  } else {
    // turish: og'irlik oyoqdan oyoqqa o'tadi, nafas
    T.sway = Math.sin(time * 0.7) * 0.025;
    T.kn = [0.05 + Math.max(0, Math.sin(time * 0.7)) * 0.08, 0.05 + Math.max(0, -Math.sin(time * 0.7)) * 0.08];
    T.up = [[0.03, 0.08 + Math.sin(time * 1.6) * 0.02], [0.03, -0.08 - Math.sin(time * 1.6) * 0.02]];
  }
  u.legs.forEach((l, i) => {
    l.thigh.rotation.z = lerp(l.thigh.rotation.z, T.th[i], k);
    l.knee.rotation.z = lerp(l.knee.rotation.z, -T.kn[i], k);
  });
  u.arms.forEach((a, i) => {
    a.upper.rotation.z = lerp(a.upper.rotation.z, T.up[i][0], k);
    a.upper.rotation.x = lerp(a.upper.rotation.x, T.up[i][1], k);
    a.elbow.rotation.z = lerp(a.elbow.rotation.z, T.el[i][0], k);
    a.elbow.rotation.x = lerp(a.elbow.rotation.x, T.el[i][1], k);
  });
  u.torso.rotation.z = lerp(u.torso.rotation.z, -T.lean, k);
  u.torso.rotation.y = lerp(u.torso.rotation.y, T.twist, k);
  u.torso.scale.y = 1 + Math.sin(time * 1.6) * 0.01; // nafas
  u.hips.position.y = lerp(u.hips.position.y, 0.92 + T.bob - (mode === 'shout' ? 0.03 : 0), k);
  u.hips.position.z = lerp(u.hips.position.z, T.sway, Math.min(1, dt * 3));

  // Ko'z qisish
  u.blink -= dt;
  const closed = u.blink < 0.12;
  if (u.blink < 0) u.blink = 2 + Math.random() * 3;
  for (const e of u.eyes) e.scale.y = closed ? 0.15 : 1;

  // Bosh: nishonga qaraydi, bo'lmasa sekin atrofga
  const local = lookAt ? guard.worldToLocal(lookAt.clone()) : null;
  const yaw = local ? THREE.MathUtils.clamp(Math.atan2(-local.z, local.x), -1.1, 1.1) : Math.sin(time * 0.35) * 0.6 + Math.sin(time * 1.3) * 0.08;
  u.neck.rotation.y = lerp(u.neck.rotation.y, yaw, Math.min(1, dt * 4));
  u.neck.rotation.z = mode === 'shout' ? Math.sin(time * 14) * 0.08 - 0.1 : lerp(u.neck.rotation.z, 0, k);
}

// Mashina fizikasi: tezlik, tezlanish → g'ildirak aylanishi, burun egilishi, stop-chiroq
function driveCar(car, x, z, dt) {
  const u = car.userData;
  if (u.lastX === null) u.lastX = x;
  const dx = x - u.lastX;
  const v = dt > 0 ? dx / dt : 0;
  const a = dt > 0 ? (v - u.v) / dt : 0;
  u.a = lerp(u.a, a, Math.min(1, dt * 6));
  u.v = v;
  u.lastX = x;
  car.position.set(x, 0, z);
  const dir = Math.cos(car.rotation.y); // +1 o'ngga, -1 chapga
  for (const w of u.wheels) w.rotation.z -= (dx * dir) / 0.24;
  // tormozda burun pastga, tezlanishda orqaga cho'kadi
  u.body.rotation.z = lerp(u.body.rotation.z, THREE.MathUtils.clamp(u.a * dir * -0.006, -0.05, 0.05), Math.min(1, dt * 8));
  u.body.position.y = Math.sin(performance.now() / 90) * 0.004 * Math.min(1, Math.abs(v) / 3); // yo'l titrashi
  const braking = Math.abs(v) < 0.3 || u.a * Math.sign(v || 1) < -0.5;
  u.tail.emissiveIntensity = lerp(u.tail.emissiveIntensity, braking ? 2.2 : 0.4, Math.min(1, dt * 10));
}

// ---------- Ssenariylar: t (soniya) → mashina, shlagbaum, qorovul holati ----------
const HOME = new THREE.Vector3(2.3, 0, -2.55);
// To'xtash nuqtalari: oldingi bamper shlagbaumdan ~2 m oldin, kamera raqamni ko'radigan joyda
const STOP_IN = -3.5;
const STOP_OUT = 3.5;
const approach = (t, from, to) => lerp(from, to, 1 - (1 - seg(t, 0, 2.2)) ** 2.4); // sekinlab to'xtaydi
const depart = (t, from, to, t0) => lerp(from, to, seg(t, t0, t0 + 3) ** 2); // asta tezlanadi

// Kamera o'qishi uchun mashina shlagbaum oldida kutadi — qorovul "Kirgizish"ni bosguncha
function arriveScene(t) {
  return {
    car: { x: approach(t, -15, STOP_IN), z: -0.95, rot: 0 }, done: false, hold: true, cam: 'in',
    lift: 0, guard: { pos: HOME, mode: 'idle' }, say: null,
  };
}

function enterScene(t) {
  const x = t < 2.2 ? approach(t, -15, STOP_IN) : depart(t, STOP_IN, 16, 3.2);
  return {
    car: { x, z: -0.95, rot: 0 }, done: t > 6.4, cam: t < 3.4 ? 'in' : null,
    lift: smooth(seg(t, 2.2, 3.1)) - smooth(seg(t, 4.6, 5.6)),
    guard: { pos: HOME, mode: t > 2.0 && t < 4.4 ? 'wave' : 'idle' },
    say: t > 2.1 && t < 4.2 ? 'Xush kelibsiz!' : null,
  };
}

function exitScene(t) {
  const x = t < 2.2 ? approach(t, 15, STOP_OUT) : depart(t, STOP_OUT, -16, 3.2);
  return {
    car: { x, z: 0.95, rot: Math.PI }, done: t > 6.4, cam: t < 3.4 ? 'out' : null,
    lift: smooth(seg(t, 2.2, 3.1)) - smooth(seg(t, 4.6, 5.6)),
    guard: { pos: HOME, mode: t > 2.0 && t < 4.4 ? 'wave' : 'idle' },
    say: t > 2.1 && t < 4.2 ? "Oq yo'l!" : null,
  };
}

// To'lay olmadi: qorovul mashinaga yurib boradi, baqiradi, shlagbaum ochiladi, mashina qochadi, qorovul qaytadi
const SHOUT_SPOT = new THREE.Vector3(3.6, 0, -0.1);
function expelScene(t) {
  const x = t < 2.0 ? lerp(15, 3.4, 1 - (1 - seg(t, 0, 2.0)) ** 2.4)
    : t < 6.2 ? 3.4 + Math.sin(t * 40) * 0.012 * seg(t, 5.2, 6.2) // dvigatel o'kirib titraydi
      : lerp(3.4, -18, seg(t, 6.2, 7.8) ** 1.6);
  let pos;
  let mode = 'idle';
  if (t >= 1.4 && t < 3.0) { pos = HOME.clone().lerp(SHOUT_SPOT, smooth(seg(t, 1.4, 3.0))); mode = 'walk'; }
  else if (t >= 3.0 && t < 8.4) { pos = SHOUT_SPOT; mode = 'shout'; }
  else if (t >= 8.4 && t < 10.2) { pos = SHOUT_SPOT.clone().lerp(HOME, smooth(seg(t, 8.4, 10.2))); mode = 'walk'; }
  else pos = HOME;
  return {
    car: { x, z: 0.95, rot: Math.PI }, done: t > 10.6, cam: t < 3 ? 'out' : null,
    lift: smooth(seg(t, 5.6, 6.3)) - smooth(seg(t, 8.0, 8.9)),
    guard: { pos, mode },
    say: t > 3.0 && t < 8.6 ? GRAWLIX[Math.floor(t * 2.2) % GRAWLIX.length] : null,
    angry: true,
  };
}
function rejectScene(t) {
  return {
    car: { x: lerp(STOP_IN, -16, smooth(seg(t, 0.6, 4.5))), z: -0.95, rot: 0 }, done: t > 4.6, cam: t < 1.5 ? 'in' : null,
    lift: 0, guard: { pos: HOME, mode: t < 2.5 ? 'wave' : 'idle' }, say: t < 2.4 ? 'Kechirasiz, joy yo\'q' : null,
  };
}
const SCENES = { reject: rejectScene, arrive: arriveScene, enter: enterScene, exit: exitScene, expel: expelScene };

// Raqam kameralari: yo'l chetida, shlagbaumdan oldin, 1,3 m balandlikda — qanot raqamni to'smaydi.
// Kirish kamerasi shlagbaumning chap tomonida (chapdan kelayotgan mashinaga qaraydi), chiqishniki o'ngda.
const CAM_X = 0.5;
const CAM_Z = -2.25;

function buildWorld(scene) {
  const ground = mesh(new THREE.PlaneGeometry(60, 30), mat(0x2b2e33, { roughness: 1 }), { shadow: false });
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const yellow = mat(0xf2c230);
  const white = mat(0xeceae4);
  for (let x = -20; x < 20; x += 2.4) scene.add(box(1.2, 0.01, 0.12, yellow, { x, y: 0.005, shadow: false }));
  for (const z of [-2.0, 2.0]) scene.add(box(40, 0.01, 0.08, white, { y: 0.006, z, shadow: false }));
  scene.add(box(0.25, 0.01, 2, white, { x: -1.5, y: 0.007, z: -1, shadow: false }));
  scene.add(box(0.25, 0.01, 2, white, { x: 1.5, y: 0.007, z: 1, shadow: false }));

  // Bordyur, trotuar, maysa
  for (const z of [-2.35, 2.35]) scene.add(box(40, 0.14, 0.3, mat(0x8d8f93), { y: 0.07, z }));
  scene.add(box(40, 0.1, 2.2, mat(0x5b5e63), { y: 0.05, z: -3.6 }));
  scene.add(box(40, 0.08, 4, mat(0x3f5a3a, { roughness: 1 }), { y: 0.04, z: 4.6 }));
  const leaf = mat(0x47704a, { flatShading: true });
  for (const [x, z, s] of [[-7, 4.2, 1], [6.5, 4.6, 1.2], [-3, 5.4, 0.8], [10, 3.8, 0.9]]) {
    scene.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.1, 8), mat(0x5a4030), { x, y: 0.55, z }));
    const crown = mesh(new THREE.IcosahedronGeometry(0.75 * s, 0), leaf, { x, y: 1.5 * s + 0.4, z });
    crown.rotation.set(x, z, 0);
    scene.add(crown);
  }
  for (const x of [-6, 5]) {
    scene.add(box(0.1, 3.2, 0.1, mat(0x6f7378), { x, y: 1.6, z: -2.7 }));
    scene.add(box(0.7, 0.06, 0.18, mat(0x6f7378), { x: x + 0.3, y: 3.2, z: -2.6 }));
    scene.add(box(0.3, 0.04, 0.14, mat(0xfff1c8, { emissive: 0xfff1c8, emissiveIntensity: 2 }), { x: x + 0.5, y: 3.16, z: -2.6, shadow: false }));
    const lamp = new THREE.PointLight(0xffd9a0, 6, 7, 1.6);
    lamp.position.set(x + 0.5, 3, -2.4);
    scene.add(lamp);
  }

  // Budka va "P" belgisi
  scene.add(box(1.4, 1.9, 1.4, mat(0xd9d6cf), { x: 0.4, y: 0.95, z: -3.4 }));
  scene.add(box(1.8, 0.14, 1.8, mat(0x2257d6), { x: 0.4, y: 1.97, z: -3.4 }));
  scene.add(box(0.02, 0.7, 1, mat(0x9fc3ff, { roughness: 0.05, metalness: 0.3, emissive: 0x334466, emissiveIntensity: 0.4 }), { x: 1.11, y: 1.25, z: -3.4 }));
  scene.add(box(0.08, 2.8, 0.08, mat(0x8a8f96), { x: -2.4, y: 1.4, z: -2.8 }));
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2257d6';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 108, 108);
  g.fillStyle = '#fff';
  g.font = 'bold 92px Arial';
  g.textAlign = 'center';
  g.fillText('P', 64, 98);
  const signTex = new THREE.CanvasTexture(c);
  signTex.colorSpace = THREE.SRGBColorSpace;
  scene.add(mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: signTex }), { x: -2.4, y: 2.85, z: -2.75 }));

  // Raqam o'qiydigan kamera ustuni (ikkita kamera: kirish va chiqish tomonga)
  for (const dir of [1, -1]) {
    scene.add(box(0.07, 1.3, 0.07, mat(0x6f7378), { x: -dir * CAM_X, y: 0.65, z: CAM_Z - 0.05 }));
    const cam = box(0.3, 0.13, 0.13, mat(0xe9eaec), { x: -dir * CAM_X, y: 1.36, z: CAM_Z });
    cam.rotation.y = dir > 0 ? -0.5 : Math.PI + 0.5;
    cam.add(box(0.03, 0.08, 0.08, mat(0x111111, { emissive: 0x223355, emissiveIntensity: 0.6 }), { x: -0.16 }));
    scene.add(cam);
  }

  // Shlagbaum: ustun, qarshi yuk, qizil-oq qanot
  scene.add(box(0.36, 1.1, 0.36, yellow, { y: 0.55, z: -2.5 }));
  const pivot = new THREE.Group();
  pivot.position.set(0, 1.0, -2.5);
  pivot.add(box(0.2, 0.2, 0.5, mat(0x3a3d43), { z: -0.35 }));
  for (let i = 0; i < 8; i++) pivot.add(box(0.1, 0.1, 0.56, mat(i % 2 ? 0xffffff : 0xe5484d), { z: 0.3 + i * 0.56 }));
  scene.add(pivot);
  return pivot;
}

export default function Gate3D({ event, arrival, reject, onPlateRead }) {
  const mount = useRef(null);
  const bubble = useRef(null);
  const camBox = useRef(null);
  // Ikki mustaqil yo'lak: kirish (kelish, kirish) va chiqish (chiqish, haydash) — har birida o'z navbati va mashinasi
  const queue = useRef({ in: [], out: [] });
  const current = useRef({ in: null, out: null }); // { fn, t, ev, read }
  const onRead = useRef(onPlateRead);
  useEffect(() => { onRead.current = onPlateRead; }, [onPlateRead]);

  useEffect(() => {
    const el = mount.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x24272c);
    scene.fog = new THREE.Fog(0x24272c, 16, 30);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    const plateCam = new THREE.PerspectiveCamera(7, 16 / 10, 0.1, 40); // tor burchakli raqam kamerasi

    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30343a, 1.3));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(5, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10 });
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const pivot = buildWorld(scene);
    const guard = buildGuard();
    guard.position.copy(HOME);
    guard.rotation.y = -Math.PI / 2;
    scene.add(guard);
    const cars = { in: buildCar(), out: buildCar() };
    for (const c of Object.values(cars)) {
      c.visible = false;
      scene.add(c);
    }

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const clock = new THREE.Clock();
    const still = reduced();
    const headPos = new THREE.Vector3();
    const look = new THREE.Vector3();

    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const time = clock.elapsedTime;
      const states = {};
      for (const lane of ['in', 'out']) {
        const car = cars[lane];
        if (!current.current[lane] && queue.current[lane].length) {
          const ev = queue.current[lane].shift();
          if (!still) {
            current.current[lane] = { fn: SCENES[ev.type], t: 0, ev, read: false };
            car.userData.paint.color.set(paintFor(ev.plate));
            car.userData.setPlate(ev.plate);
            car.userData.lastX = null;
            car.visible = true;
          }
        }
        const cur = current.current[lane];
        if (!cur) continue;
        cur.t += dt;
        const st = cur.fn(cur.t);
        car.rotation.y = st.car.rot;
        driveCar(car, st.car.x, st.car.z, dt);
        // Mashina to'xtagach kamera raqamni "aniqlaydi"
        if (st.hold && cur.t > 3 && !cur.read) {
          cur.read = true;
          onRead.current?.(cur.ev.plate);
        }
        if (st.done) {
          current.current[lane] = null;
          car.visible = false;
        }
        states[lane] = { ...st, lane, plate: cur.ev.plate };
      }
      // Shlagbaum bitta: qaysi yo'lak so'rasa, ochiladi
      pivot.rotation.x = -Math.max(states.in?.lift ?? 0, states.out?.lift ?? 0) * (Math.PI / 2.05);

      // Qorovul bitta: band yo'lakka (avval chiqish — haydash muhimroq) e'tibor beradi
      const busy = (st) => st && st.guard.mode !== 'idle';
      const focus = busy(states.out) ? states.out : busy(states.in) ? states.in : states.in ?? states.out;
      const gstate = focus?.guard ?? { pos: HOME, mode: 'idle' };
      const focusCar = focus && cars[focus.lane].visible ? cars[focus.lane] : null;
      const target = gstate.pos;
      const moving = guard.position.distanceTo(target) > 0.005;
      const facing = moving
        ? Math.atan2(-(target.z - guard.position.z), target.x - guard.position.x)
        : focusCar ? Math.atan2(-(focusCar.position.z - guard.position.z), focusCar.position.x - guard.position.x) : -Math.PI / 2;
      guard.rotation.y = lerpAngle(guard.rotation.y, facing, Math.min(1, dt * 5));
      guard.position.copy(target);
      if (focusCar) look.set(focusCar.position.x, 1, focusCar.position.z);
      poseGuard(guard, gstate.mode, time, dt, focusCar ? look : null);
      const state = { say: focus?.say, angry: focus?.angry };

      // Asosiy kamera sekin chayqaladi — sahna jonli ko'rinadi
      camera.position.set(5.6 + Math.sin(time * 0.2) * 0.25, 4.8, 8.6);
      camera.lookAt(0.4, 0.5, 0);
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setViewport(0, 0, w, h);
      renderer.setScissorTest(false);
      renderer.render(scene, camera);

      // Raqam kamerasi: ustundagi kamera mashina old raqamini kuzatadi (yuqori o'ng burchak)
      const cb = camBox.current;
      const camState = states.in?.cam ? states.in : states.out?.cam ? states.out : null;
      if (camState && cars[camState.lane].visible) {
        const car = cars[camState.lane];
        const dir = camState.cam === 'in' ? 1 : -1;
        plateCam.position.set(-dir * CAM_X, 1.36, CAM_Z + 0.08);
        look.set(car.position.x + dir * 1.2, 0.36, car.position.z);
        plateCam.lookAt(look);
        const iw = Math.round(w * 0.46);
        const ih = Math.round(iw * 0.62);
        plateCam.aspect = iw / ih;
        plateCam.updateProjectionMatrix();
        renderer.setScissorTest(true);
        renderer.setScissor(w - iw - 8, h - ih - 8, iw, ih);
        renderer.setViewport(w - iw - 8, h - ih - 8, iw, ih);
        renderer.render(scene, plateCam);
        renderer.setScissorTest(false);
        if (cb) {
          cb.className = `cam-box on${Math.abs(car.userData.v) < 0.2 ? ' locked' : ''}`;
          cb.style.width = `${iw}px`;
          cb.style.height = `${ih}px`;
          cb.querySelector('.cam-rec').textContent = dir > 0 ? 'KAMERA 1, KIRISH' : 'KAMERA 2, CHIQISH';
          cb.querySelector('.cam-conf').textContent = `aniqlik ${Math.min(99.8, 90 + (1 - Math.min(1, Math.abs(car.userData.v) / 6)) * 9.8).toFixed(1)}%`;
          const t = cb.querySelector('.cam-read');
          if (t.textContent !== camState.plate) t.textContent = camState.plate;
        }
      } else if (cb && cb.className !== 'cam-box') {
        cb.className = 'cam-box';
      }

      // Gap pufagi qorovul boshi ustida
      const b = bubble.current;
      if (b) {
        if (state.say) {
          guard.userData.head.getWorldPosition(headPos);
          headPos.y += 0.45;
          headPos.project(camera);
          b.style.transform = `translate(${(headPos.x * 0.5 + 0.5) * w}px, ${(-headPos.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
          if (b.textContent !== state.say) b.textContent = state.say;
          b.className = `say on${state.angry ? ' angry' : ''}`;
        } else if (b.className !== 'say') {
          b.className = 'say';
        }
      }
    });

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // Kamera oldiga yangi mashina keldi
  useEffect(() => {
    if (arrival) queue.current.in.push({ type: 'arrive', plate: arrival.plate });
  }, [arrival]);

  // Kiritib bo'lmadi — kutayotgan mashina orqaga qaytadi
  useEffect(() => {
    const cur = current.current.in;
    if (reject && cur?.ev.type === 'arrive' && cur.ev.plate === reject.plate) current.current.in = { ...cur, fn: rejectScene, t: 0 };
  }, [reject]);

  // Voqea: kutayotgan mashina kiritilsa — shlagbaum oldidan davom etadi, aks holda o'z yo'lagi navbatiga
  useEffect(() => {
    if (!event || !SCENES[event.type]) return;
    const lane = event.type === 'enter' ? 'in' : 'out';
    const cur = current.current.in;
    if (lane === 'in' && cur?.ev.type === 'arrive' && cur.ev.plate === event.plate) {
      current.current.in = { ...cur, fn: enterScene, t: 2.2 };
      return;
    }
    const q = queue.current[lane];
    const waiting = q.findIndex((x) => x.type === 'arrive' && x.plate === event.plate);
    if (waiting >= 0) q.splice(waiting, 1);
    q.push(event);
  }, [event]);

  const caption = event && {
    enter: `${event.label} joyiga kirdi`,
    exit: `${event.label} joyidan chiqdi`,
    expel: "to'lamadi, haydab chiqarildi",
  }[event.type];

  return (
    <div className="gate">
      <div className="gate-canvas" ref={mount} />
      <div className="cam-box" ref={camBox} aria-hidden="true">
        <span className="cam-rec">KAMERA 1</span>
        <span className="cam-frame" />
        <span className="cam-read" />
        <span className="cam-conf" />
      </div>
      <div className="say" ref={bubble} aria-hidden="true" />
      {caption && (
        <div className={`gate-caption ${event.type}`} key={event.at}>
          <span className="plate">{event.plate}</span>
          <span>{caption}</span>
        </div>
      )}
    </div>
  );
}
