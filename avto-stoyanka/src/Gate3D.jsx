// 3D kirish darvozasi. Voqealar navbat bilan o'ynaladi: kelish (kamera raqamni o'qiydi), kirish, chiqish, haydab chiqarish.
// Qorovul doim "tirik": nafas oladi, atrofga qaraydi; mashinaga qo'l ko'taradi yoki to'lamaganni haydaydi.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { clamp01, smooth, seg, lerp, lerpAngle, mat, mesh, box, drawPlate, buildCar, buildGuard, poseGuard, driveCar } from './three-kit';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { paintFor, brandFor, shapeFor } from './api';

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

// ---------- To'xtash maydoni (shlagbaumdan keyin, savdo markazi oldida) ----------
// Ikki qator × 10 joy, o'rtada yo'lak. A qator — yo'lga qaragan, B qator — savdo markaziga qaragan.
const LOT = { aisleZ: -12, rowA: -9.4, rowB: -14.6, x0: 13.2, pitch: 1.75, n: 10 };
const STALLS = [];
for (const row of ['A', 'B']) {
  for (let i = 0; i < LOT.n; i++) {
    STALLS.push({ row, x: LOT.x0 + i * LOT.pitch, z: row === 'A' ? LOT.rowA : LOT.rowB, rot: row === 'A' ? -Math.PI / 2 : Math.PI / 2 });
  }
}

// Egri yo'l bo'ylab harakat: har bo'lak — silliq (Catmull-Rom) chiziq, boshida tezlashadi, oxirida to'xtaydi.
// reverse: mashina orqaga yuradi (oldi harakatga teskari)
function makeMotion(segments) {
  const segs = segments.map(({ pts, reverse = false, speed = 3.2 }) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const len = curve.getLength();
    return { curve, reverse, dur: len / speed + 0.9 };
  });
  const total = segs.reduce((a, s) => a + s.dur, 0);
  const tan = new THREE.Vector3();
  const pos = new THREE.Vector3();
  return {
    total,
    at(t) {
      let tt = Math.max(0, t);
      for (const [i, s] of segs.entries()) {
        if (tt <= s.dur || i === segs.length - 1) {
          const p = smooth(clamp01(tt / s.dur));
          s.curve.getPointAt(p, pos);
          s.curve.getTangentAt(Math.min(0.999, Math.max(0.001, p)), tan);
          const rot = Math.atan2(-tan.z, tan.x) + (s.reverse ? Math.PI : 0);
          return { x: pos.x, z: pos.z, rot };
        }
        tt -= s.dur;
      }
      return null;
    },
  };
}

// Shlagbaumdan → maydon yo'lagi → bo'sh joyga (oldi bilan) kirish
function enterMotion(st) {
  const turnZ = st.row === 'A' ? -11.3 : -12.7;
  const nearZ = st.row === 'A' ? -10.4 : -13.6;
  const pts = [[STOP_IN, LANE_IN], [2.5, LANE_IN], [6.4, -3.3], [8.7, -4.8], [9.6, -8.6], [10.4, -11.5], [11.6, -12]];
  if (st.x - 2.4 > 12.1) pts.push([st.x - 2.4, LOT.aisleZ]);
  pts.push([st.x - 0.8, turnZ], [st.x, nearZ], [st.x, st.z]);
  return makeMotion([{ pts, speed: 3.6 }]);
}

// Joydan orqaga chiqish → maydon yo'lagi → orolcha uchini aylanib → chiqish shlagbaumi oldida to'xtash
function exitMotion(st) {
  const backZ = st.row === 'A' ? -10.6 : -13.4;
  const swingZ = st.row === 'A' ? -11.6 : -12.4;
  return makeMotion([
    { pts: [[st.x, st.z], [st.x, backZ], [st.x + 0.6, swingZ], [st.x + 1.6, LOT.aisleZ]], reverse: true, speed: 1.6 },
    { pts: [[st.x + 1.6, LOT.aisleZ], [11.2, LOT.aisleZ], [10.0, -11.0], [9.4, -8.4], [9.2, -5.4], [9.5, -2.4], [9.8, 0.2], [9.2, 2.5], [7.4, LANE_OUT], [STOP_OUT, LANE_OUT]], speed: 3.6 },
  ]);
}

// ---------- Ssenariylar: (t soniya, reja) → mashina, shlagbaum, qorovullar holati ----------
const approach = (t, from, to) => lerp(from, to, 1 - (1 - seg(t, 0, 2.4)) ** 2.4); // sekinlab to'xtaydi
const depart = (t, from, to, t0) => lerp(from, to, seg(t, t0, t0 + 3.2) ** 2); // asta tezlanadi
const idleCrew = { seat: 'sit', guard: { pos: HOME, mode: 'idle' } };
const GO = 3.4; // shlagbaum ochilib bo'lgach yurish boshlanadi

// Kamera o'qishi uchun mashina shlagbaum oldida kutadi — qorovul chekni berguncha
function arriveScene(t) {
  return { ...idleCrew, car: { x: approach(t, -16, STOP_IN), z: LANE_IN, rot: 0 }, done: false, hold: true, cam: 'in', lift: 0 };
}

// Kirish: shlagbaum oldida to'xtaydi → ochiladi → maydonga burilib, bo'sh joyga kirib to'xtaydi (o'sha yerda qoladi)
function enterScene(t, plan) {
  let car;
  if (t < 2.4) car = { x: approach(t, -16, STOP_IN), z: LANE_IN, rot: 0 };
  else if (t < GO || !plan.motion) car = { x: STOP_IN, z: LANE_IN, rot: 0 };
  else car = plan.motion.at(t - GO);
  const end = GO + (plan.motion?.total ?? 0);
  return {
    ...idleCrew, car, done: t > end + 0.3, parked: true, cam: t < 2.4 ? 'in' : null, moving: t > GO,
    lift: smooth(seg(t, 2.4, 3.3)) - smooth(seg(t, GO + 3.0, GO + 4.0)),
    seat: t > 2.2 && t < 4.6 ? 'sitwave' : 'sit', say: t > 2.3 && t < 4.4 ? 'Xush kelibsiz!' : null, speaker: 'seat',
  };
}

// Chiqish (oxirgi qismi): shlagbaum oldidan ochilib, chapga ketadi
function exitTail(t) {
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

// To'lay olmadi (oxirgi qismi): qorovul mashinaga yurib boradi, baqiradi, shlagbaum ochiladi, mashina qochadi, qorovul qaytadi
function expelTail(t) {
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

// Chiqish va haydash: avval maydondagi joyidan chiqib, shlagbaum oldiga keladi; keyin oxirgi qism
function fromLot(tail, offset) {
  return (t, plan) => {
    const A = plan.motion?.total ?? 0;
    if (plan.motion && t < A) {
      return { ...idleCrew, car: plan.motion.at(t), done: false, cam: t > A - 2.2 ? 'out' : null, lift: 0, moving: true };
    }
    const tt = t - A + (plan.motion ? offset : 0);
    const st = tail(tt);
    if (plan.motion && tt < 2.2) st.car.x = STOP_OUT; // allaqachon to'xtagan
    return st;
  };
}
const SCENES = {
  reject: rejectScene, arrive: arriveScene, enter: enterScene,
  exit: fromLot(exitTail, 2.4), expel: fromLot(expelTail, 1.4),
};

// ---------- Realistik teksturalar (canvas, tashqi fayllarsiz — oflayn ham ishlaydi) ----------
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
// Asfalt: to'q kulrang, mayda tosh donachalari, yamoqlar
const asphaltTex = (repeat) => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#34373c';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const v = 40 + Math.random() * 50;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 6; i++) {
    g.fillStyle = 'rgba(20,22,25,.18)';
    g.beginPath();
    g.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 60, 15 + Math.random() * 30, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
}, repeat);
// Trotuar plitkasi
const tileTex = (repeat) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#8f9196';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = 135 + Math.random() * 25;
    g.fillStyle = `rgb(${v},${v},${v + 3})`;
    g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
  }
}, repeat);
// Maysa: turli yashil tuslar
const grassTex = (repeat) => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#4c6b3a';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `hsl(${85 + Math.random() * 30},${35 + Math.random() * 25}%,${22 + Math.random() * 18}%)`;
    g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3);
  }
}, repeat);
// G'isht (budka devori)
const brickTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c9c2b6';
  g.fillRect(0, 0, w, h);
  for (let row = 0; row < 16; row++) for (let col = -1; col < 8; col++) {
    const x = col * 34 + (row % 2) * 17;
    const v = Math.random() * 20;
    g.fillStyle = `rgb(${176 + v},${96 + v},${72 + v})`;
    g.fillRect(x + 1, row * 16 + 1, 32, 14);
  }
}, [2, 1]);
// Bino derazalari
const facadeTex = (lit) => canvasTex(256, 512, (g, w, h) => {
  g.fillStyle = '#b9b2a6';
  g.fillRect(0, 0, w, h);
  for (let y = 16; y < h - 20; y += 44) for (let x = 14; x < w - 20; x += 40) {
    g.fillStyle = Math.random() < lit ? '#ffe2a8' : '#5d7590';
    g.fillRect(x, y, 24, 30);
  }
});
// Osmon: kechki gradient
const skyTex = () => {
  const t = canvasTex(16, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#6f9fd3');
    grd.addColorStop(0.55, '#b9d2e8');
    grd.addColorStop(0.8, '#f1d9b8');
    grd.addColorStop(1, '#e8c79c');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
};

// Daraxt: egri tana, bir nechta barg to'plami (turli yashil), soya tashlaydi
const LEAVES = [0x4f7a3a, 0x5d8a43, 0x3f6a32, 0x6b9a4c];
function buildTree(x, z, s = 1, seed = 1) {
  const t = new THREE.Group();
  t.position.set(x, 0, z);
  const bark = mat(0x5a4432, { roughness: 1 });
  const trunk = mesh(new THREE.CylinderGeometry(0.09 * s, 0.16 * s, 1.6 * s, 9), bark, { y: 0.8 * s });
  trunk.rotation.z = Math.sin(seed) * 0.08;
  t.add(trunk);
  for (let i = 0; i < 6; i++) {
    const a = seed * 1.7 + i * 1.05;
    const r = (0.55 + ((seed * 7 + i * 3) % 5) * 0.08) * s;
    const blob = mesh(new THREE.IcosahedronGeometry(r, 1), mat(LEAVES[(seed + i) % LEAVES.length], { roughness: 0.9 }), {
      x: Math.cos(a) * 0.45 * s, y: (1.8 + (i % 3) * 0.35) * s, z: Math.sin(a) * 0.45 * s,
    });
    blob.scale.y = 0.85;
    t.add(blob);
  }
  return t;
}
function buildBush(x, z, s = 1, seed = 1) {
  const b = new THREE.Group();
  b.position.set(x, 0.1, z);
  for (let i = 0; i < 4; i++) {
    b.add(mesh(new THREE.IcosahedronGeometry(0.28 * s, 1), mat(LEAVES[(seed + i) % 4], { roughness: 0.95 }), {
      x: (i - 1.5) * 0.25 * s, y: 0.2 * s + (i % 2) * 0.08, z: ((seed + i) % 3 - 1) * 0.12,
    }));
  }
  return b;
}
// Ko'cha chirog'i: ustun, egilgan bo'yin, yoritgich
function buildLamp(scene, x, z, face) {
  const metal = mat(0x50555c, { metalness: 0.7, roughness: 0.35 });
  scene.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 4.2, 10), metal, { x, y: 2.1, z }));
  scene.add(box(0.06, 0.06, 1.1, metal, { x, y: 4.2, z: z + face * 0.5 }));
  scene.add(box(0.22, 0.08, 0.42, metal, { x, y: 4.16, z: z + face * 1.05 }));
  scene.add(box(0.18, 0.02, 0.36, mat(0xfff1c8, { emissive: 0xfff1c8, emissiveIntensity: 2.5 }), { x, y: 4.11, z: z + face * 1.05, shadow: false }));
  const light = new THREE.PointLight(0xffd9a0, 4, 9, 1.6);
  light.position.set(x, 4, z + face * 1.05);
  scene.add(light);
}

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
  const wall = new THREE.MeshStandardMaterial({ map: brickTex(), roughness: 0.9 });
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
  // eshik (+x tomonda, ochiq qismda), tutqich
  g.add(box(0.05, 1.95, d * 0.55, mat(0x6f7378, { metalness: 0.5, roughness: 0.4 }), { x: w / 2 + 0.03, y: 1.02, z: d * 0.2 }));
  g.add(box(0.05, 1.0, d * 0.4, glass, { x: w / 2 + 0.06, y: 1.45, z: d * 0.2, shadow: false }));
  g.add(box(0.04, 0.04, 0.12, mat(0xd9dde3, { metalness: 1, roughness: 0.2 }), { x: w / 2 + 0.08, y: 1.0, z: d * 0.38 }));
  // konditsioner tashqi bloki va kuzatuv kamerasi
  const ac = box(0.32, 0.5, 0.7, mat(0xe9eaec, { roughness: 0.5 }), { x: w / 2 + 0.2, y: 1.7, z: -d * 0.3 });
  ac.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20), mat(0x2a2c30), { x: 0.165 }));
  ac.children[0].rotation.z = Math.PI / 2;
  g.add(ac);
  const dome = mesh(new THREE.SphereGeometry(0.08, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x111111, { metalness: 0.3, roughness: 0.1 }), { x: -w / 2 - 0.1, y: 1.96, z: -d / 2 - 0.1 });
  dome.rotation.x = Math.PI;
  g.add(dome);
  // tom tarnovi
  g.add(box(w + 0.66, 0.06, 0.06, mat(0x8d8f93, { metalness: 0.5 }), { y: 2.25, z: d / 2 + 0.33 }));
}

function buildWorld(scene) {
  // Asfalt, maysa, trotuarlar
  const ground = mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshStandardMaterial({ map: grassTex([18, 12]), roughness: 1 }), { shadow: false });
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const road = mesh(new THREE.BoxGeometry(44, 0.02, ROAD_EDGE * 2), new THREE.MeshStandardMaterial({ map: asphaltTex([11, 2.4]), roughness: 0.92 }), { y: 0.01, shadow: false });
  road.receiveShadow = true;
  scene.add(road);
  const white = mat(0xeceae4, { roughness: 0.8 });
  const yellow = mat(0xf2c230, { roughness: 0.7 });
  const curbMat = mat(0x8d8f93);
  const walk = (len) => new THREE.MeshStandardMaterial({ map: tileTex([len / 2, 1.1]), roughness: 0.85 });
  scene.add(box(44, 0.16, 0.3, curbMat, { y: 0.08, z: ROAD_EDGE + 0.15 }));
  scene.add(box(44, 0.12, 2.2, walk(44), { y: 0.06, z: ROAD_EDGE + 1.4 }));
  // -z tomonda trotuar maydon kirish yo'li (x 7,6..11) da uziladi
  for (const [x0, x1] of [[-22, 7.6], [11, 22]]) {
    scene.add(box(x1 - x0, 0.16, 0.3, curbMat, { x: (x0 + x1) / 2, y: 0.08, z: -ROAD_EDGE - 0.15 }));
    scene.add(box(x1 - x0, 0.12, 2.2, walk(x1 - x0), { x: (x0 + x1) / 2, y: 0.06, z: -ROAD_EDGE - 1.4 }));
  }
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
  scene.add(box(12.4, 0.17, ISLAND * 2 - 0.4, new THREE.MeshStandardMaterial({ map: tileTex([6, 1.3]), roughness: 0.85 }), { x: 0.5, y: 0.085 }));
  for (const end of [-6, 7]) for (let i = 0; i < 6; i++) scene.add(box(0.2, 0.17, 0.5, i % 2 ? yellow : mat(0x15171a), { x: end, y: 0.09, z: -1.25 + i * 0.5 }));
  // Daraxtlar qatori (trotuar ortida) va butalar
  let seed = 1;
  for (const z of [-ROAD_EDGE - 3.4, ROAD_EDGE + 3.4]) {
    for (let x = -20; x <= 20; x += 4.2) {
      if (z < 0 && (Math.abs(x - 0.5) < 2 || x > 5)) continue; // budka ro'parasi va to'xtash maydoni ochiq
      scene.add(buildTree(x + Math.sin(seed) * 0.6, z + Math.cos(seed) * 0.4, 0.95 + (seed % 3) * 0.12, seed++));
    }
    for (let x = -19; x <= 19; x += 2.1) if (z > 0 || x < 6) scene.add(buildBush(x, z > 0 ? z - 1.2 : z + 1.2, 0.8 + (seed % 2) * 0.2, seed++));
  }
  for (const x of [-5.2, 6.2]) scene.add(buildBush(x, 0, 1, seed++)); // orolchadagi gulzor
  // Ko'cha chiroqlari ikki tomonda
  for (const x of [-12, -4, 4]) buildLamp(scene, x, -ROAD_EDGE - 0.6, 1);
  for (const x of [6, 14]) buildLamp(scene, x, ROAD_EDGE + 0.6, -1); // old tomonda — kamerani to'smaydigan joylarda
  // Uzoqdagi binolar (shahar fon) — ortda
  for (let i = 0; i < 13; i++) {
    const h = 10 + ((i * 37) % 7) * 2.2;
    const bw = 6 + (i % 3) * 2;
    const bld = mesh(new THREE.BoxGeometry(bw, h, 6), new THREE.MeshStandardMaterial({ map: facadeTex(0.25), roughness: 0.8 }), { x: -40 + i * 7.6, y: h / 2, z: -40 - (i % 2) * 4, shadow: false });
    scene.add(bld);
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

// ---------- To'xtash maydoni: asfalt, bo'yalgan joylar, bordyur, yo'nalish o'qlari ----------
function buildLot(scene) {
  const cx = 19.6;
  const cz = -12.3;
  scene.add(mesh(new THREE.BoxGeometry(23, 0.02, 10.4), new THREE.MeshStandardMaterial({ map: asphaltTex([6, 2.8]), roughness: 0.92 }), { x: cx, y: 0.012, z: cz, shadow: false }));
  // maydonga kirish yo'li (trotuar orqali)
  scene.add(mesh(new THREE.BoxGeometry(3.4, 0.022, 3.2), new THREE.MeshStandardMaterial({ map: asphaltTex([1, 1]), roughness: 0.92 }), { x: 9.3, y: 0.013, z: -6.2, shadow: false }));
  const white = mat(0xeceae4, { roughness: 0.8 });
  for (const [z0, z1] of [[-8.1, -10.7], [-13.3, -15.9]]) {
    for (let k = 0; k <= LOT.n; k++) {
      const x = LOT.x0 - LOT.pitch / 2 + k * LOT.pitch;
      scene.add(box(0.08, 0.01, Math.abs(z1 - z0), white, { x, y: 0.026, z: (z0 + z1) / 2, shadow: false }));
    }
    const back = z0 < -12 ? z1 : z0;
    scene.add(box(LOT.n * LOT.pitch, 0.01, 0.08, white, { x: LOT.x0 - LOT.pitch / 2 + (LOT.n * LOT.pitch) / 2, y: 0.026, z: back, shadow: false }));
  }
  // yo'lakdagi o'qlar va "P" yozuvi
  const arrow = textTexture('→   →   →', { font: 'bold 90px Arial' });
  scene.add(decal(arrow, 9, 0.9, 20, LOT.aisleZ, 0));
  // bordyur va butalar maydon atrofida
  const curb = mat(0x9a9c9f, { roughness: 0.8 });
  scene.add(box(23.4, 0.16, 0.25, curb, { x: cx + 0.9, y: 0.08, z: -17.6 }));
  scene.add(box(0.25, 0.16, 10.4, curb, { x: 31.2, y: 0.08, z: cz }));
  let seed = 40;
  for (let x = 12; x <= 30; x += 2.2) scene.add(buildBush(x, -7.6, 0.8, seed++));
}

// ---------- Savdo markazi: egri shisha fasad, to'lqinli tom-soyabon, burama minora ----------
// Yozuv: "Tashkent City Mall" — podium tepasida, maydonga qaragan
function buildMall(scene) {
  const g = new THREE.Group();
  g.position.set(21, 0, -21.5);
  scene.add(g);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x8fb4d6, metalness: 0.6, roughness: 0.06, clearcoat: 1, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  const glassTex = canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#5f86ad';
    c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 40) {
      const v = Math.random();
      c.fillStyle = v < 0.25 ? '#ffe7b8' : v < 0.6 ? '#7fa6cc' : '#4f7399'; // ichkarida yorug' do'konlar
      c.fillRect(x + 2, y + 2, 36, 28);
    }
  }, [6, 1]);
  glass.map = glassTex;
  const slab = mat(0xf1efe9, { roughness: 0.5 });
  const W = 13; // yarim kenglik

  // Podium old tomoni — qavariq egri shisha devor (2 qavat)
  const curve = new THREE.QuadraticBezierCurve(new THREE.Vector2(-W, 0), new THREE.Vector2(0, -4.2), new THREE.Vector2(W, 0));
  const pts = curve.getPoints(48);
  const H = 7.2;
  const pos = [];
  const uv = [];
  pts.forEach((p, i) => {
    pos.push(p.x, 0, -p.y, p.x, H, -p.y);
    uv.push(i / 48, 0, i / 48, 1);
  });
  const idx = [];
  for (let i = 0; i < pts.length - 1; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  wallGeo.setIndex(idx);
  wallGeo.computeVertexNormals();
  const front = new THREE.Mesh(wallGeo, glass);
  g.add(front);
  // qavat plitalari — xuddi shu egri shaklda (old qismi bo'rtib chiqqan)
  const plan = new THREE.Shape();
  plan.moveTo(-W, 0);
  plan.quadraticCurveTo(0, -4.2, W, 0);
  plan.lineTo(W, 10);
  plan.lineTo(-W, 10);
  plan.closePath();
  for (const y of [0, 3.6, H]) {
    const sg = new THREE.ExtrudeGeometry(plan, { depth: 0.3, bevelEnabled: false, curveSegments: 32 });
    const s = mesh(sg, slab, { y: y + 0.3 });
    s.rotation.x = -Math.PI / 2;
    s.scale.set(y === H ? 1.04 : 1.01, 1, 1);
    g.add(s);
  }
  // yon va orqa devorlar
  const side = new THREE.MeshStandardMaterial({ map: facadeTex(0.35), roughness: 0.7 });
  g.add(box(0.4, H, 10, side, { x: -W, y: H / 2, z: -5 }));
  g.add(box(0.4, H, 10, side, { x: W, y: H / 2, z: -5 }));
  g.add(box(2 * W, H, 0.4, side, { y: H / 2, z: -10 }));
  // Kirish: shisha eshiklar, aylanma eshik, ustidagi soyabon
  g.add(box(6, 3.0, 0.1, mat(0x1a2430, { metalness: 0.5, roughness: 0.1 }), { y: 1.8, z: 2.12 }));
  const revolve = mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.8, 24, 1, true), glass, { y: 1.7, z: 2.9 });
  g.add(revolve);
  g.add(box(8, 0.18, 2.4, slab, { y: 3.4, z: 3.0 }));
  g.userData.revolve = revolve;

  // To'lqinli tom-soyabon (noodatiy belgi): yupqa yuzani sinus bo'ylab egamiz
  const roofGeo = new THREE.PlaneGeometry(30, 15, 60, 30);
  const rp = roofGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const y = rp.getY(i);
    rp.setZ(i, Math.sin(x * 0.32) * 0.9 + Math.cos(y * 0.45) * 0.4);
  }
  roofGeo.computeVertexNormals();
  const roof = mesh(roofGeo, mat(0xf4efe3, { metalness: 0.3, roughness: 0.35, side: THREE.DoubleSide }), { y: H + 2.3, z: -4 });
  roof.rotation.x = -Math.PI / 2;
  g.add(roof);
  for (const [x, z] of [[-12, 0.3], [-6, 1.6], [0, 2.0], [6, 1.6], [12, 0.3]]) g.add(mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.2, 10), slab, { x, y: H + 1.1, z }));

  // Burama minora: har qavat oldingisidan 7° burilgan elliptik shisha "disk"
  const tower = new THREE.Group();
  tower.position.set(10, H + 0.4, -6);
  for (let i = 0; i < 10; i++) {
    const fl = new THREE.Group();
    fl.position.y = i * 1.0;
    fl.rotation.y = (i * 7 * Math.PI) / 180;
    const pane = mesh(new THREE.CylinderGeometry(1, 1, 0.86, 40, 1, true), glass, { y: 0.43 });
    pane.scale.set(3.4, 1, 2.2);
    const deck = mesh(new THREE.CylinderGeometry(1, 1, 0.14, 40), slab, { y: 0.93 });
    deck.scale.set(3.55, 1, 2.32);
    fl.add(pane, deck);
    tower.add(fl);
  }
  // minora tepasida chiroq-toj
  tower.add(mesh(new THREE.TorusGeometry(2.6, 0.08, 8, 48), mat(0xf2c230, { emissive: 0xf2c230, emissiveIntensity: 1.4, metalness: 0.8 }), { y: 10.3 }));
  tower.children.at(-1).rotation.x = Math.PI / 2;
  g.add(tower);

  // Yozuv: "Tashkent City Mall" — oltin harflar, qora tasmada, o'z yorug'ligi bilan
  const sign = canvasTex(2048, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(18,20,24,.92)';
    c.fillRect(0, 30, w, h - 60);
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#fff3c2');
    grd.addColorStop(0.5, '#f2c230');
    grd.addColorStop(1, '#b8860b');
    c.fillStyle = grd;
    c.font = 'bold 150px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('Tashkent City Mall', w / 2, h / 2 + 6);
  });
  sign.wrapS = sign.wrapT = THREE.ClampToEdgeWrapping;
  const board = mesh(new THREE.PlaneGeometry(17, 2.1), new THREE.MeshStandardMaterial({ map: sign, transparent: true, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.9 }), { y: H + 1.15, z: 2.3, shadow: false });
  g.add(board);

  // Oldidagi maydoncha: plitka, gulzorlar, bayroqlar, daraxtlar
  scene.add(mesh(new THREE.BoxGeometry(30, 0.06, 2.0), new THREE.MeshStandardMaterial({ map: tileTex([12, 1.4]), roughness: 0.85 }), { x: 21, y: 0.03, z: -18.6, shadow: false }));
  for (const x of [7, 35]) scene.add(buildTree(x, -20, 1.1, x));
  const flagCloth = [0x1eb5e0, 0xf4f3ef, 0x1fa35a];
  for (let i = 0; i < 3; i++) {
    const fx = 16 + i * 1.2;
    scene.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 8), mat(0xd9dde3, { metalness: 1, roughness: 0.2 }), { x: fx, y: 2, z: -18.4 }));
    const cloth = mesh(new THREE.PlaneGeometry(0.9, 0.55, 8, 4), mat(flagCloth[i], { side: THREE.DoubleSide, roughness: 0.8 }), { x: fx + 0.45, y: 3.65, z: -18.4 });
    scene.add(cloth);
    g.userData.flags = [...(g.userData.flags || []), cloth];
  }
  return g;
}

// ---------- Piyodalar: maydon ↔ savdo markazi eshigi orasida yurishadi ----------
const CIVILIANS = [
  { uniform: 0x8a2f2f, hair: 0x2a1d14, skin: 0xe8b98f, epaulets: false, girth: 0.95, brows: 0x2a1d14 },
  { uniform: 0x2e5e8a, hair: 0x0e0e0e, skin: 0xc98f62, epaulets: false, girth: 1.05, brows: 0x0e0e0e, glasses: 'glasses' },
  { uniform: 0xe6e3dc, hair: 0x6a4a2a, skin: 0xf0caa4, epaulets: false, girth: 0.9, brows: 0x6a4a2a },
  { uniform: 0x3a5a3a, hair: 0x1a1410, skin: 0xd9a77e, epaulets: false, girth: 1.1, brows: 0x1a1410, mustache: 0x1a1410 },
  { uniform: 0x5a3a7a, hair: 0x2a1d14, skin: 0xe0b088, epaulets: false, girth: 0.92, brows: 0x2a1d14 },
];
function buildWalkers(scene) {
  return CIVILIANS.map((c, i) => {
    const p = buildGuard(c);
    p.scale.setScalar(0.95);
    scene.add(p);
    const x = 14 + i * 3;
    // aylanma yo'l: joylar orasidan → plitka → eshik oldi → qaytish
    const loop = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 0, -11.8), new THREE.Vector3(x + 0.6, 0, -16.6), new THREE.Vector3(20 + (i - 2) * 0.6, 0, -19.0),
      new THREE.Vector3(21 + (i - 2) * 0.4, 0, -13.2 - 0.0), new THREE.Vector3(x - 0.4, 0, -12.4),
    ], true, 'centripetal');
    return { p, loop, len: loop.getLength(), s: (i * 0.23) % 1, speed: 1.0 + (i % 3) * 0.15 };
  });
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
  const [big, setBig] = useState(false); // butun ekran
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
    scene.background = skyTex();
    scene.fog = new THREE.Fog(0xd8d3c8, 34, 85);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    renderer.toneMappingExposure = 1.05;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 160);
    const plateCam = new THREE.PerspectiveCamera(12, 16 / 10, 0.1, 40); // tor burchakli raqam kamerasi

    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30343a, 1.3));
    const sun = new THREE.DirectionalLight(0xffe7c4, 2.6); // past quyosh — uzun soyalar
    sun.position.set(-6, 16, 8);
    sun.target.position.set(8, 0, -8);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 26, bottom: -26, far: 90 });
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const barriers = buildWorld(scene);
    buildLot(scene);
    const mall = buildMall(scene);
    const walkers = buildWalkers(scene);

    // Maydondagi joylar: qaysi joyda qaysi mashina turibdi
    const lot = STALLS.map((st) => ({ ...st, car: null, plate: null, reserved: false, since: 0 }));
    const parkAt = (st, car, plate) => {
      car.position.set(st.x, 0, st.z);
      car.rotation.y = st.rot;
      car.visible = true;
      Object.assign(st, { car, plate, reserved: false, since: performance.now() });
    };
    // Bo'sh joy: savdo markaziga yaqin qatordan; to'lsa — eng eski mashina ketgan hisoblanadi
    const freeStall = () => {
      const free = lot.filter((st) => !st.car && !st.reserved).sort((a, b) => (a.row === b.row ? a.x - b.x : a.row === 'B' ? -1 : 1));
      if (free.length) return free[Math.floor(Math.random() * Math.min(4, free.length))];
      const oldest = lot.filter((st) => st.car).sort((a, b) => a.since - b.since)[0];
      if (!oldest) return null;
      scene.remove(oldest.car);
      Object.assign(oldest, { car: null, plate: null });
      return oldest;
    };
    // Boshida maydonda bir nechta mashina turibdi
    const DECOR = [[0xc9ccd1, 'sedan'], [0x3b4a6b, 'suv'], [0x8a2f2f, 'sedan'], [0xe6e3dc, 'sport'], [0x1f2226, 'suv'], [0x9a7b4f, 'sedan'], [0x5b6f8a, 'sedan'], [0x4f5a52, 'suv']];
    for (const [i, [paint, type]] of DECOR.entries()) {
      const st = lot[(i * 7 + 3) % lot.length];
      if (st.car) continue;
      const c = buildCar(type);
      c.userData.paint.color.set(paint);
      c.userData.setPlate(`${10 + i * 10}A${120 + i * 53}BA`);
      scene.add(c);
      parkAt(st, c, null);
    }
    const camTarget = new THREE.Vector3(6.5, 2.2, -8);
    const camGoal = new THREE.Vector3();
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
        let car = cars[lane];
        if (!current.current[lane] && queue.current[lane].length) {
          const ev = queue.current[lane].shift();
          if (!still) {
            let plan = {};
            if (ev.type === 'enter' || ev.type === 'arrive') {
              const st = freeStall();
              if (st) {
                st.reserved = true;
                plan = { stall: st, motion: enterMotion(st) };
              }
            } else {
              const occupied = lot.filter((st) => st.car);
              const st = lot.find((x) => x.car && x.plate === ev.plate) || occupied[Math.floor(Math.random() * occupied.length)];
              if (st) {
                plan = { stall: st, motion: exitMotion(st), lotCar: st.car };
                Object.assign(st, { car: null, plate: null });
              }
            }
            current.current[lane] = { fn: SCENES[ev.type], t: 0, ev, read: false, plan };
            // markaga mos kuzov turi (sedan / suv / sport); chiqishda — maydondagi mashina
            const type = shapeFor(brandFor(ev.plate, false));
            if (plan.lotCar) {
              scene.remove(cars[lane]);
              cars[lane] = plan.lotCar;
            } else if (cars[lane].userData.type !== type) {
              scene.remove(cars[lane]);
              cars[lane] = buildCar(type);
              scene.add(cars[lane]);
            }
            const fresh = cars[lane];
            fresh.userData.paint.color.set(paintFor(ev.plate));
            fresh.userData.setPlate(ev.plate);
            fresh.userData.lastX = null;
            fresh.visible = true;
            car = fresh;
          }
        }
        const cur = current.current[lane];
        if (!cur) continue;
        cur.t += dt;
        const st = cur.fn(cur.t, cur.plan);
        car.rotation.y = st.car.rot;
        driveCar(car, st.car.x, st.car.z, dt);
        // Mashina to'xtagach kamera raqamni "aniqlaydi"
        if (st.hold && cur.t > 3.2 && !cur.read) {
          cur.read = true;
          onRead.current?.(cur.ev.plate);
        }
        if (st.done) {
          current.current[lane] = null;
          if (st.parked && cur.plan.stall) {
            // joyida qoladi; yo'lak uchun yangi mashina
            parkAt(cur.plan.stall, car, cur.ev.plate);
            cars[lane] = buildCar();
            cars[lane].visible = false;
            scene.add(cars[lane]);
          } else {
            if (cur.plan.stall?.reserved) cur.plan.stall.reserved = false; // qaytarildi — joy bo'sh
            car.visible = false;
            if (cur.plan.lotCar) {
              scene.remove(car);
              cars[lane] = buildCar();
              cars[lane].visible = false;
              scene.add(cars[lane]);
            }
          }
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

      // Piyodalar savdo markaziga borib-kelishadi
      for (const wk of walkers) {
        wk.s = (wk.s + (dt * wk.speed) / wk.len) % 1;
        const p = wk.loop.getPointAt(wk.s);
        const tn = wk.loop.getTangentAt(wk.s);
        wk.p.position.copy(p);
        wk.p.rotation.y = Math.atan2(-tn.z, tn.x);
        poseGuard(wk.p, 'walk', time, dt, null);
      }
      mall.userData.revolve.rotation.y += dt * 0.5;
      for (const cloth of mall.userData.flags) {
        const a = cloth.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) a.setZ(i, Math.sin(a.getX(i) * 7 + time * 6) * 0.06 * (a.getX(i) + 0.45));
        a.needsUpdate = true;
      }

      // Kamera: savdo markazi, maydon va darvoza bir kadrda; harakatdagi mashinani yumshoq kuzatadi
      const mover = states.in?.moving && cars.in.visible ? cars.in : states.out?.moving && cars.out.visible ? cars.out : null;
      camGoal.set(6.5, 2.2, -8);
      if (mover) camGoal.lerp(look.set(mover.position.x, 1.2, mover.position.z), 0.4);
      camTarget.lerp(camGoal, Math.min(1, dt * 1.1));
      camera.position.set(camTarget.x - 15 + Math.sin(time * 0.15) * 0.4, 9.6, camTarget.z + 18.5);
      camera.lookAt(camTarget);
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
        const front = car.position.x + dir * (car.userData.front + 0.04);
        look.set(front, car.userData.plateY, car.position.z);
        // 2,6 m oldinda, biroz yon tomonda va tepada — haqiqiy raqam kamerasi burchagi
        plateCam.position.set(front + dir * 2.6, car.userData.plateY + 0.28, car.position.z + (dir > 0 ? 0.55 : -0.55));
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

  useEffect(() => {
    if (!big) return;
    const onKey = (e) => e.key === 'Escape' && setBig(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);

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
    <div className={big ? 'gate expanded' : 'gate'}>
      <div className="gate-canvas" ref={mount} />
      <button type="button" className="gate-zoom" onClick={() => setBig((v) => !v)} aria-pressed={big}>
        {big ? 'Kichraytirish (Esc)' : 'Kattalashtirish'}
      </button>
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
