// 3D kirish darvozasi. Voqealar navbat bilan o'ynaladi: kelish (kamera raqamni o'qiydi), kirish, chiqish, haydab chiqarish.
// Qorovul doim "tirik": nafas oladi, atrofga qaraydi; mashinaga qo'l ko'taradi yoki to'lamaganni haydaydi.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { smooth, seg, lerp, lerpAngle, mat, mesh, box, drawPlate, buildCar, buildGuard, poseGuard, driveCar } from './three-kit';
import { paintFor } from './api';

// "Shifrlangan" so'kinishlar — tsenzura belgilarida
const GRAWLIX = ['#@$%&!', '%&*#@!!', '$#!%@?!', '@#&%$!!', '*%$#@&!'];

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// ---------- Joylashuv ----------
// Ikki yo'lak: kirish (z < 0, chapdan o'ngga) va chiqish (z > 0, o'ngdan chapga), o'rtada orolcha va budka.
const ISLAND = 1.5; // orolcha yarim kengligi
const LANE_IN = -3.15;
const LANE_OUT = 3.15;
const ROAD_EDGE = 4.85;
const BOOTH = { x: 2.1, w: 2.6, d: 1.9 }; // budka orolchada, shlagbaumdan keyin
const STOP_IN = -3.4; // kirish: oldingi bamper stop chizig'ida
const STOP_OUT = 3.4;
const CAM_IN = new THREE.Vector3(1.25, 0.75, -1.4); // raqam kameralari shlagbaumdan keyin, past — qanot to'smaydi
const CAM_OUT = new THREE.Vector3(-1.25, 0.75, 1.4);
const SEAT = new THREE.Vector3(BOOTH.x - 0.55, 0, 0.1); // budkadagi qorovul stuli (kirish tomon oynaga qaragan)
const HOME = new THREE.Vector3(BOOTH.x + BOOTH.w / 2 + 0.7, 0, 0.45); // tashqaridagi qorovul joyi
const SHOUT_SPOT = new THREE.Vector3(3.7, 0, ISLAND + 0.25);

// ---------- Ssenariylar: t (soniya) → mashina, shlagbaum, qorovullar holati ----------
const approach = (t, from, to) => lerp(from, to, 1 - (1 - seg(t, 0, 2.4)) ** 2.4); // sekinlab to'xtaydi
const depart = (t, from, to, t0) => lerp(from, to, seg(t, t0, t0 + 3.2) ** 2); // asta tezlanadi
const idleCrew = { seat: 'sit', guard: { pos: HOME, mode: 'idle' } };

// Kamera o'qishi uchun mashina shlagbaum oldida kutadi — qorovul chekni berguncha
function arriveScene(t) {
  return { ...idleCrew, car: { x: approach(t, -16, STOP_IN), z: LANE_IN, rot: 0 }, done: false, hold: true, cam: 'in', lift: 0 };
}

function enterScene(t) {
  const x = t < 2.4 ? approach(t, -16, STOP_IN) : depart(t, STOP_IN, 17, 3.4);
  return {
    ...idleCrew, car: { x, z: LANE_IN, rot: 0 }, done: t > 6.8, cam: t < 2.4 ? 'in' : null,
    lift: smooth(seg(t, 2.4, 3.3)) - smooth(seg(t, 5.0, 6.0)),
    seat: t > 2.2 && t < 4.6 ? 'sitwave' : 'sit', say: t > 2.3 && t < 4.4 ? 'Xush kelibsiz!' : null, speaker: 'seat',
  };
}

function exitScene(t) {
  const x = t < 2.4 ? approach(t, 16, STOP_OUT) : depart(t, STOP_OUT, -17, 3.4);
  return {
    ...idleCrew, car: { x, z: LANE_OUT, rot: Math.PI }, done: t > 6.8, cam: t < 2.4 ? 'out' : null,
    lift: smooth(seg(t, 2.4, 3.3)) - smooth(seg(t, 5.0, 6.0)),
    guard: { pos: HOME, mode: t > 2.2 && t < 4.6 ? 'wave' : 'idle' }, say: t > 2.3 && t < 4.4 ? "Oq yo'l!" : null, speaker: 'guard',
  };
}

// Kiritib bo'lmadi: kutib turgan mashina orqaga yurib ketadi
function rejectScene(t) {
  return {
    ...idleCrew, car: { x: lerp(STOP_IN, -16, smooth(seg(t, 0.8, 4.8))), z: LANE_IN, rot: 0 }, done: t > 5, cam: t < 1.5 ? 'in' : null,
    lift: 0, seat: t < 2.6 ? 'sitwave' : 'sit', say: t < 2.6 ? "Kechirasiz, joy yo'q" : null, speaker: 'seat',
  };
}

// To'lay olmadi: tashqaridagi qorovul mashinaga yurib boradi, baqiradi, shlagbaum ochiladi, mashina qochadi, qorovul qaytadi
function expelScene(t) {
  const x = t < 2.2 ? lerp(16, STOP_OUT, 1 - (1 - seg(t, 0, 2.2)) ** 2.4)
    : t < 6.4 ? STOP_OUT + Math.sin(t * 40) * 0.012 * seg(t, 5.4, 6.4) // dvigatel o'kirib titraydi
      : lerp(STOP_OUT, -19, seg(t, 6.4, 8.0) ** 1.6);
  let pos;
  let mode = 'idle';
  if (t >= 1.4 && t < 3.0) { pos = HOME.clone().lerp(SHOUT_SPOT, smooth(seg(t, 1.4, 3.0))); mode = 'walk'; }
  else if (t >= 3.0 && t < 8.6) { pos = SHOUT_SPOT; mode = 'shout'; }
  else if (t >= 8.6 && t < 10.4) { pos = SHOUT_SPOT.clone().lerp(HOME, smooth(seg(t, 8.6, 10.4))); mode = 'walk'; }
  else pos = HOME;
  return {
    car: { x, z: LANE_OUT, rot: Math.PI }, done: t > 10.8, cam: t < 3 ? 'out' : null,
    lift: smooth(seg(t, 5.8, 6.5)) - smooth(seg(t, 8.2, 9.1)),
    seat: 'sit', guard: { pos, mode }, speaker: 'guard',
    say: t > 3.0 && t < 8.8 ? GRAWLIX[Math.floor(t * 2.2) % GRAWLIX.length] : null, angry: true,
  };
}
const SCENES = { reject: rejectScene, arrive: arriveScene, enter: enterScene, exit: exitScene, expel: expelScene };

// Yozuvli tekstura (yo'l belgilari, budka peshlavhasi)
function textTexture(text, { w = 512, h = 128, bg = null, fg = '#fff', font = 'bold 72px Arial' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  g.fillStyle = fg;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const decal = (tex, w, h, x, z, rotZ = 0) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false }));
  m.rotation.set(-Math.PI / 2, 0, rotZ);
  m.position.set(x, 0.012, z);
  m.receiveShadow = true;
  return m;
};

// Shlagbaum: shkaf-ustun, qarshi yuk, chiziqli qanot, uchida tayanch, ogohlantirish chirog'i.
// side = -1: qanot -z tomonga (kirish yo'lagi), +1: +z tomonga (chiqish yo'lagi)
function buildBarrier(scene, side) {
  const z0 = side * (ISLAND - 0.25);
  const cabinet = mesh(new THREE.BoxGeometry(0.42, 1.05, 0.36), mat(0xf2c230, { roughness: 0.45 }), { y: 0.6, z: z0 });
  scene.add(cabinet);
  scene.add(box(0.36, 0.08, 0.3, mat(0x2a2c30), { y: 1.16, z: z0 })); // qopqoq
  scene.add(box(0.44, 0.12, 0.38, mat(0x2a2c30), { y: 0.1, z: z0 })); // poydevor
  const beacon = mesh(new THREE.SphereGeometry(0.07, 14, 10), mat(0xff8a00, { emissive: 0xff8a00, emissiveIntensity: 0.2 }), { y: 1.36, z: z0, shadow: false });
  scene.add(beacon);

  const pivot = new THREE.Group();
  pivot.position.set(0, 1.0, z0);
  pivot.add(box(0.22, 0.2, 0.45, mat(0x3a3d43, { metalness: 0.5, roughness: 0.4 }), { z: -side * 0.32 })); // qarshi yuk
  // Qanot: oq-qizil chiziqli quvur (bitta tekstura)
  const len = ROAD_EDGE - ISLAND + 0.1;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 16;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#e5484d';
    g.fillRect(i * 64, 0, 64, 16);
  }
  const stripes = new THREE.CanvasTexture(c);
  stripes.colorSpace = THREE.SRGBColorSpace;
  const arm = mesh(new THREE.CylinderGeometry(0.045, 0.055, len, 16), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.35 }), { z: side * (len / 2 + 0.1) });
  arm.rotation.x = Math.PI / 2;
  stripes.rotation = Math.PI / 2;
  stripes.center.set(0.5, 0.5);
  pivot.add(arm);
  for (let i = 1; i < 6; i++) pivot.add(mesh(new THREE.SphereGeometry(0.03, 8, 6), mat(0xff3b3b, { emissive: 0xff3b3b, emissiveIntensity: 0.8 }), { y: 0.06, z: side * (0.2 + i * len / 6), shadow: false }));
  scene.add(pivot);
  // Qanot uchi tayanchi (yo'l chetida)
  const restZ = side * (ROAD_EDGE - 0.15);
  scene.add(box(0.08, 0.92, 0.08, mat(0xf2c230), { y: 0.46, z: restZ }));
  scene.add(box(0.2, 0.06, 0.08, mat(0x2a2c30), { y: 0.95, z: restZ }));
  return { pivot, beacon, side };
}

// Qorovul budkasi: pastki qismi g'isht-panel, yuqorisi oyna, ichida stol, monitor, stul, chiroq
function buildBooth(scene) {
  const { x, w, d } = BOOTH;
  const wall = mat(0xd9d6cf, { roughness: 0.8 });
  const trim = mat(0x6f7378, { metalness: 0.4, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xa9cfff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.2, depthWrite: false });
  const g = new THREE.Group();
  g.position.set(x, 0.15, 0);
  scene.add(g);
  g.add(box(w + 0.1, 0.08, d + 0.1, mat(0x8d8f93), { y: 0.04 })); // pol
  // pastki devorlar (eshik +x tomonda)
  g.add(box(0.08, 1.0, d, wall, { x: -w / 2, y: 0.54 }));
  g.add(box(w, 1.0, 0.08, wall, { y: 0.54, z: -d / 2 }));
  g.add(box(w, 1.0, 0.08, wall, { y: 0.54, z: d / 2 }));
  g.add(box(0.08, 1.0, d * 0.35, wall, { x: w / 2, y: 0.54, z: -d * 0.325 }));
  // yuqori oynalar
  for (const [gw, gd, gx, gz] of [[0.02, d, -w / 2, 0], [w, 0.02, 0, -d / 2], [w, 0.02, 0, d / 2], [0.02, d * 0.35, w / 2, -d * 0.325]]) {
    g.add(mesh(new THREE.BoxGeometry(gw, 1.05, gd), glass, { x: gx, y: 1.57, z: gz, shadow: false }));
  }
  // ustunlar va oyna romlari
  for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [w / 2, 0.3]]) g.add(box(0.08, 2.1, 0.08, trim, { x: px, y: 1.09, z: pz }));
  g.add(box(w, 0.05, 0.1, trim, { y: 1.05, z: -d / 2 }));
  g.add(box(w, 0.05, 0.1, trim, { y: 1.05, z: d / 2 }));
  g.add(box(0.1, 0.05, d, trim, { x: -w / 2, y: 1.05 }));
  // tom: chiqib turuvchi, ko'k peshtoq va yozuv
  g.add(box(w + 0.6, 0.12, d + 0.6, mat(0xe8e6e0), { y: 2.2 }));
  g.add(box(w + 0.62, 0.2, d + 0.62, mat(0x2257d6), { y: 2.08 }));
  const sign = textTexture("QO'RIQLASH POSTI", { w: 1024, h: 96, font: 'bold 64px Arial' });
  for (const [z, ry] of [[d / 2 + 0.32, 0], [-d / 2 - 0.32, Math.PI]]) {
    const p = mesh(new THREE.PlaneGeometry(w + 0.4, 0.17), new THREE.MeshStandardMaterial({ map: sign, transparent: true, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.6 }), { y: 2.08, z, shadow: false });
    p.rotation.y = ry;
    g.add(p);
  }
  // ichki jihozlar: stol, monitor, stul, chiroq
  const desk = mat(0x8a6a4a, { roughness: 0.6 });
  g.add(box(0.55, 0.05, d - 0.3, desk, { x: -w / 2 + 0.35, y: 0.78 }));
  g.add(box(0.05, 0.74, d - 0.3, desk, { x: -w / 2 + 0.12, y: 0.42 }));
  const monitor = box(0.04, 0.32, 0.5, mat(0x15171a), { x: -w / 2 + 0.3, y: 1.02, z: 0.35 });
  monitor.rotation.y = 0.35;
  monitor.add(box(0.005, 0.27, 0.44, mat(0x2a6fdb, { emissive: 0x3a7fff, emissiveIntensity: 0.9 }), { x: 0.025 }));
  g.add(monitor);
  g.add(box(0.2, 0.03, 0.3, mat(0x2a2c30), { x: -w / 2 + 0.42, y: 0.81, z: -0.15 })); // klaviatura
  const chair = mat(0x2a2c30, { roughness: 0.6 });
  g.add(box(0.46, 0.07, 0.46, chair, { x: SEAT.x - x + 0.05, y: 0.42, z: SEAT.z }));
  g.add(box(0.07, 0.55, 0.44, chair, { x: SEAT.x - x + 0.3, y: 0.72, z: SEAT.z }));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 8), trim, { x: SEAT.x - x + 0.05, y: 0.22, z: SEAT.z }));
  const lamp = new THREE.PointLight(0xffe2b0, 3, 4, 1.5);
  lamp.position.set(0, 1.9, 0);
  g.add(lamp);
}

function buildWorld(scene) {
  // Asfalt, maysa, trotuarlar
  const ground = mesh(new THREE.PlaneGeometry(70, 40), mat(0x3f5a3a, { roughness: 1 }), { shadow: false });
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const asphalt = mat(0x2b2e33, { roughness: 0.95 });
  const road = mesh(new THREE.BoxGeometry(44, 0.02, ROAD_EDGE * 2), asphalt, { y: 0.01, shadow: false });
  scene.add(road);
  const white = mat(0xeceae4, { roughness: 0.8 });
  const yellow = mat(0xf2c230, { roughness: 0.7 });
  for (const z of [-ROAD_EDGE - 0.15, ROAD_EDGE + 0.15]) scene.add(box(44, 0.16, 0.3, mat(0x8d8f93), { y: 0.08, z }));
  for (const z of [-ROAD_EDGE - 1.4, ROAD_EDGE + 1.4]) scene.add(box(44, 0.12, 2.2, mat(0x5b5e63), { y: 0.06, z }));
  // Yo'lak chiziqlari va stop chiziqlari
  for (const z of [-(ISLAND + 0.15), ISLAND + 0.15, -(ROAD_EDGE - 0.2), ROAD_EDGE - 0.2]) {
    for (let x = -21; x < 21; x += 2) scene.add(box(1.1, 0.01, 0.1, white, { x, y: 0.022, z, shadow: false }));
  }
  scene.add(box(0.3, 0.01, ROAD_EDGE - ISLAND, white, { x: -1.2, y: 0.023, z: -(ROAD_EDGE + ISLAND) / 2, shadow: false }));
  scene.add(box(0.3, 0.01, ROAD_EDGE - ISLAND, white, { x: 1.2, y: 0.023, z: (ROAD_EDGE + ISLAND) / 2, shadow: false }));
  // Yo'ldagi yozuvlar va o'qlar
  const inTex = textTexture('KIRISH  →', { font: 'bold 84px Arial' });
  const outTex = textTexture('←  CHIQISH', { font: 'bold 84px Arial' });
  scene.add(decal(inTex, 3.6, 0.9, -7, LANE_IN, 0));
  scene.add(decal(outTex, 3.6, 0.9, 7, LANE_OUT, 0));
  // Orolcha: bordyurli, ichida maysa, uchlari sariq-qora
  scene.add(box(13, 0.16, ISLAND * 2, mat(0x9a9c9f), { x: 0.5, y: 0.08 }));
  scene.add(box(12.4, 0.17, ISLAND * 2 - 0.4, mat(0x6f7477), { x: 0.5, y: 0.085 }));
  for (const end of [-6, 7]) for (let i = 0; i < 6; i++) scene.add(box(0.2, 0.17, 0.5, i % 2 ? yellow : mat(0x15171a), { x: end, y: 0.09, z: -1.25 + i * 0.5 }));
  // Daraxtlar, chiroq ustunlari
  const leaf = mat(0x47704a, { flatShading: true });
  for (const [x, z, s] of [[-9, 7.4, 1], [10, 7.8, 1.1], [-3, 8.4, 0.8], [-12, -7.6, 1], [5, -8, 0.9]]) {
    scene.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.1, 8), mat(0x5a4030), { x, y: 0.55, z }));
    const crown = mesh(new THREE.IcosahedronGeometry(0.75 * s, 0), leaf, { x, y: 1.5 * s + 0.4, z });
    crown.rotation.set(x, z, 0);
    scene.add(crown);
  }
  for (const [x, z] of [[-6.5, 0], [8, 0]]) {
    scene.add(box(0.1, 3.4, 0.1, mat(0x6f7378), { x, y: 1.85, z }));
    for (const s of [-1, 1]) {
      scene.add(box(0.12, 0.05, 1.1, mat(0x6f7378), { x, y: 3.5, z: z + s * 0.55 }));
      scene.add(box(0.2, 0.04, 0.3, mat(0xfff1c8, { emissive: 0xfff1c8, emissiveIntensity: 2 }), { x, y: 3.46, z: z + s * 1.05, shadow: false }));
      const lamp = new THREE.PointLight(0xffd9a0, 5, 8, 1.6);
      lamp.position.set(x, 3.3, z + s * 1.4);
      scene.add(lamp);
    }
  }
  // "P" belgisi kirishda
  const pTex = textTexture('P', { w: 128, h: 128, bg: '#2257d6', font: 'bold 96px Arial' });
  scene.add(box(0.08, 2.8, 0.08, mat(0x8a8f96), { x: -4.2, y: 1.4, z: -ROAD_EDGE - 0.6 }));
  scene.add(mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: pTex }), { x: -4.2, y: 2.85, z: -ROAD_EDGE - 0.55 }));

  // Nogironlar belgisi: "nogironlar uchun bepul" (kirishda, yo'l chetida)
  {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 320;
    const g = c.getContext('2d');
    g.fillStyle = '#1e5bd8';
    g.fillRect(0, 0, 256, 320);
    g.strokeStyle = '#fff';
    g.lineWidth = 8;
    g.strokeRect(10, 10, 236, 300);
    g.save();
    g.translate(38, 22);
    g.scale(7.5, 7.5);
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(11, 4.6, 1.4, 0, Math.PI * 2);
    g.fill();
    g.stroke(new Path2D('M11 7.5 V13 H15.8 L18 18 M11 10 H15'));
    g.stroke(new Path2D('M8.6 11 a5 5 0 1 0 6.9 7'));
    g.restore();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = 'bold 44px Arial';
    g.fillText('BEPUL', 128, 270);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.add(box(0.08, 2.4, 0.08, mat(0x8a8f96), { x: -6.2, y: 1.2, z: -ROAD_EDGE - 0.6 }));
    const board = mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }), { x: -6.2, y: 2.25, z: -ROAD_EDGE - 0.55 });
    scene.add(board);
    // Yo'l yuzasidagi bo'yalgan belgi (kirish yo'lagida)
    scene.add(decal(tex, 1.1, 1.38, -10, LANE_IN, Math.PI / 2));
  }

  // Raqam kameralari (past ustun, mashinaga qaragan)
  for (const [p, face] of [[CAM_IN, -1], [CAM_OUT, 1]]) {
    scene.add(box(0.07, p.y, 0.07, mat(0x6f7378), { x: p.x, y: p.y / 2 + 0.15, z: p.z }));
    const cam = box(0.28, 0.12, 0.12, mat(0xe9eaec), { x: p.x, y: p.y + 0.2, z: p.z });
    cam.rotation.y = face < 0 ? -0.45 : Math.PI - 0.45;
    cam.add(box(0.03, 0.07, 0.07, mat(0x111111, { emissive: 0x223355, emissiveIntensity: 0.6 }), { x: -0.15 }));
    scene.add(cam);
  }

  buildBooth(scene);
  return [buildBarrier(scene, -1), buildBarrier(scene, 1)];
}

// Ikki qorovul: budkadagi — keksaroq, yashil forma, oq mo'ylov; tashqaridagi — yosh, ko'k forma, jilet
const GUARD_SEATED = { uniform: 0x2f4a3a, cap: 0x23362b, skin: 0xd9a77e, mustache: 0xd8d8d8, vest: false, girth: 1.15, brows: 0xbfbfbf };
const GUARD_OUTSIDE = { uniform: 0x24448f, cap: 0x1b2a55, skin: 0xe8b98f, mustache: null, vest: true, girth: 1, brows: 0x3a2a20 };

export default function Gate3D({ event, arrival, reject, release, onPlateRead }) {
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
    scene.fog = new THREE.Fog(0x24272c, 20, 38);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const plateCam = new THREE.PerspectiveCamera(7, 16 / 10, 0.1, 40); // tor burchakli raqam kamerasi

    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30343a, 1.3));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(6, 11, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -12 });
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const barriers = buildWorld(scene);
    const seated = buildGuard(GUARD_SEATED);
    seated.position.copy(SEAT).setY(0.15);
    seated.rotation.y = Math.PI; // stolga (kirish tomon oynaga) qaragan
    scene.add(seated);
    const guard = buildGuard(GUARD_OUTSIDE);
    guard.position.copy(HOME);
    guard.rotation.y = -Math.PI / 2; // chiqish yo'lagiga qaragan
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
        if (st.hold && cur.t > 3.2 && !cur.read) {
          cur.read = true;
          onRead.current?.(cur.ev.plate);
        }
        if (st.done) {
          current.current[lane] = null;
          car.visible = false;
        }
        states[lane] = { ...st, lane, plate: cur.ev.plate };
      }

      // Har yo'lakning o'z shlagbaumi; harakatlanganda chiroq miltillaydi
      for (const b of barriers) {
        const lift = (b.side < 0 ? states.in : states.out)?.lift ?? 0;
        b.pivot.rotation.x = -b.side * lift * (Math.PI / 2.05);
        const moving = lift > 0.01 && lift < 0.99;
        b.beacon.material.emissiveIntensity = moving ? (Math.sin(time * 14) > 0 ? 3 : 0.3) : 0.2;
      }

      // Budkadagi qorovul: kirish yo'lagiga qaraydi, salomlashadi
      const focusIn = states.in && cars.in.visible ? cars.in : states.out && cars.out.visible ? cars.out : null;
      if (focusIn) look.set(focusIn.position.x, 1, focusIn.position.z);
      const seatMode = states.in?.seat === 'sitwave' || states.out?.seat === 'sitwave' ? 'sitwave' : 'sit';
      poseGuard(seated, seatMode, time, dt, focusIn ? look.clone() : null);

      // Tashqaridagi qorovul: chiqish yo'lagi (xayrlashish, haydash)
      const gs = states.out?.guard ?? { pos: HOME, mode: 'idle' };
      const outCar = states.out && cars.out.visible ? cars.out : null;
      const target = gs.pos;
      const moving = guard.position.distanceTo(target) > 0.005;
      const facing = moving
        ? Math.atan2(-(target.z - guard.position.z), target.x - guard.position.x)
        : outCar ? Math.atan2(-(outCar.position.z - guard.position.z), outCar.position.x - guard.position.x) : -Math.PI / 2;
      guard.rotation.y = lerpAngle(guard.rotation.y, facing, Math.min(1, dt * 5));
      guard.position.copy(target);
      if (outCar) look.set(outCar.position.x, 1, outCar.position.z);
      poseGuard(guard, gs.mode, time, dt, outCar ? look : null);

      // Gapiruvchi: chiqish voqeasi bo'lsa — tashqaridagi qorovul, aks holda budkadagi
      const talk = states.out?.say ? states.out : states.in?.say ? states.in : null;
      const speaker = talk?.speaker === 'guard' ? guard : seated;

      // Asosiy kamera sekin chayqaladi — sahna jonli ko'rinadi
      camera.position.set(4.6 + Math.sin(time * 0.2) * 0.25, 4.6, 8.4);
      camera.lookAt(1.0, 0.7, 0);
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setViewport(0, 0, w, h);
      renderer.setScissorTest(false);
      renderer.render(scene, camera);

      // Raqam kamerasi: mashina old raqamini kuzatadi (yuqori o'ng burchak)
      const cb = camBox.current;
      const camState = states.in?.cam ? states.in : states.out?.cam ? states.out : null;
      if (camState && cars[camState.lane].visible) {
        const car = cars[camState.lane];
        const dir = camState.cam === 'in' ? 1 : -1;
        // Ob'ektiv kamera qutisining ichida — ko'rish nuqtasini 0,35 m oldinga (raqam tomonga) chiqaramiz
        look.set(car.position.x + dir * 1.24, 0.34, car.position.z);
        plateCam.position.copy(dir > 0 ? CAM_IN : CAM_OUT);
        plateCam.position.y += 0.2;
        plateCam.position.add(look.clone().sub(plateCam.position).normalize().multiplyScalar(0.35));
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
          const t = cb.querySelector('.cam-read b');
          if (t.textContent !== camState.plate) {
            t.textContent = camState.plate;
            drawPlate(cb.querySelector('.cam-plate').getContext('2d'), camState.plate); // o'qilgan raqam kesimi
          }
        }
      } else if (cb && cb.className !== 'cam-box') {
        cb.className = 'cam-box';
      }

      // Gap pufagi gapirayotgan qorovul boshi ustida
      const b = bubble.current;
      if (b) {
        if (talk) {
          speaker.userData.head.getWorldPosition(headPos);
          headPos.y += 0.45;
          headPos.project(camera);
          b.style.transform = `translate(${(headPos.x * 0.5 + 0.5) * w}px, ${(-headPos.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
          if (b.textContent !== talk.say) b.textContent = talk.say;
          b.className = `say on${talk.angry ? ' angry' : ''}`;
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

  // Chek berildi — kutayotgan mashina shlagbaum oldidan kiradi
  useEffect(() => {
    const cur = current.current.in;
    if (release && cur?.ev.type === 'arrive' && cur.ev.plate === release.plate) current.current.in = { ...cur, fn: enterScene, t: 2.4 };
  }, [release]);

  // Kiritib bo'lmadi — kutayotgan mashina orqaga qaytadi
  useEffect(() => {
    const cur = current.current.in;
    if (reject && cur?.ev.type === 'arrive' && cur.ev.plate === reject.plate) current.current.in = { ...cur, fn: rejectScene, t: 0 };
  }, [reject]);

  // Server voqeasi: kamera oldida kutayotgan mashina bo'lsa — chek berilishini kutadi, aks holda o'z yo'lagi navbatiga
  useEffect(() => {
    if (!event || !SCENES[event.type]) return;
    const lane = event.type === 'enter' ? 'in' : 'out';
    const waitingNow = current.current.in?.ev.type === 'arrive' && current.current.in.ev.plate === event.plate;
    if (lane === 'in' && (waitingNow || queue.current.in.some((x) => x.type === 'arrive' && x.plate === event.plate))) return;
    queue.current[lane].push(event);
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
        <span className="cam-read"><canvas className="cam-plate" width="512" height="112" /><b /></span>
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

// WebGL sahnasi qisman yangilanishda (HMR) eskirib qolmasin — fayl o'zgarsa sahifa to'liq yangilanadi
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
