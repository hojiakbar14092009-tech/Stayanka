// 3D kirish darvozasi. Voqealar navbat bilan o'ynaladi: kelish (kamera raqamni o'qiydi), kirish, chiqish, haydab chiqarish.
// Qorovul doim "tirik": nafas oladi, atrofga qaraydi; mashinaga qo'l ko'taradi yoki to'lamaganni haydaydi.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { clamp01, smooth, seg, lerp, lerpAngle, mat, mesh, box, drawPlate, buildCar, buildParkedCar, buildGuard, poseGuard, driveCar } from './three-kit';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { paintFor, brandFor, shapeFor, VIP_PERKS } from './api';

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

// ---------- Ko'p qavatli garaj: 200 joy, 2D reja bilan bir xil joylashuv ----------
// 1-qavat: A (VIP) + B; 2-qavat: C + D; 3-qavat (ochiq tom): E. Ikki spiral rampa: sharqiy — chiqish, g'arbiy — tushish.
// Har zona — 10 ustun × 4 qator: 1-qator, yo'lak, 2-qator, ustunlar, 3-qator, yo'lak, 4-qator.
const FLOOR_H = 3.2;
const G = { x0: 10, x1: 48.6, zF: -8, zB: -25.8, xL: 10.9, xR: 47.7, lane1: -12.3, lane2: -21.5 };
const ROWS_Z = [-9.3, -15.3, -18.5, -24.5];
const PITCH = 1.75;
const ZONE_POS = { A: [0, 11.8], B: [0, 29.3], C: [1, 11.8], D: [1, 29.3], E: [2, 11.8] }; // [qavat, blok x0]
const HELIX = { x: 52.6, z: -16.9, r: 3.9 }; // yuqoriga chiqish rampasi
const HELIX_DOWN = { x: 6, z: -16.9, r: 3.9 }; // pastga tushish rampasi (chiqish yo'liga yaqin)
// Kamera: darvoza ko'rinishi va bo'sh paytdagi sayr nuqtalari [qaraladigan nuqta, kamera siljishi]
const GATE_VIEW = [new THREE.Vector3(5, 1.4, -4.5), new THREE.Vector3(-5, 11, 21)]; // qorovul uchun: oldinda budka, ikki yo'lak va shlagbaumlar, ortida garaj kirishi
// Bo'sh payt: umumiy ko'rinish — darvoza va butun garaj
const OVERVIEW = [new THREE.Vector3(17, 2, -9), new THREE.Vector3(-12, 25, 38)]; // budka va butun garaj
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// "B-07" → 3D joy: qavat, koordinata, qaysi yo'lakdan kiriladi, mashina qaysi tomonga qaraydi
function stallFor(label) {
  const [zone, num] = String(label || '').split('-');
  const pos = ZONE_POS[zone];
  const n = Number(num) - 1;
  if (!pos || !(n >= 0 && n < 40)) return null;
  const row = Math.floor(n / 10);
  const z = ROWS_Z[row];
  const laneZ = row < 2 ? G.lane1 : G.lane2;
  const toward = Math.sign(z - laneZ); // yo'lakdan joyga qaysi tomonga
  return {
    label, zone, level: pos[0], y: pos[0] * FLOOR_H, x: pos[1] + PITCH / 2 + (n % 10) * PITCH, z, laneZ, toward,
    rot: toward > 0 ? -Math.PI / 2 : Math.PI / 2, // oldi bilan kiradi
  };
}

// Keskin orqaga qaytadigan va juda yaqin nuqtalarni olib tashlaymiz — yo'l tugun hosil qilmasin
function clean(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out.at(-1);
    const b = pts[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.35 && i < pts.length - 1) continue;
    const c = pts[i + 1];
    if (c && out.length > 1) {
      const p = out.at(-2);
      const v1 = [a[0] - p[0], a[1] - p[1]];
      const v2 = [b[0] - a[0], b[1] - a[1]];
      if ((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1) < -0.5) continue;
    }
    out.push(b);
  }
  return out;
}

// Silliq yo'l (3D: [x, z, y]); boshida tezlashadi, oxirida to'xtaydi; uzun yo'lda tezroq. reverse: orqaga yuradi
function makeMotion(segments) {
  const segs = segments.map(({ pts, reverse = false, speed = 3.2 }) => {
    const curve = new THREE.CatmullRomCurve3(clean(pts).map(([x, z, y = 0]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
    const len = curve.getLength();
    return { curve, reverse, dur: len / (speed * (reverse ? 1 : 1 + len / 120)) + 0.9 };
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
          const pitch = Math.atan2(tan.y, Math.hypot(tan.x, tan.z) || 1) * (s.reverse ? -1 : 1);
          return { x: pos.x, y: pos.y, z: pos.z, rot, pitch };
        }
        tt -= s.dur;
      }
      return null;
    },
  };
}

// Spiral rampa: g'arbiy nuqtadan boshlab, har aylanishda bir qavat ko'tariladi
function helixPts(level) {
  const pts = [];
  const steps = level * 24;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = Math.PI + f * level * Math.PI * 2;
    pts.push([HELIX.x + HELIX.r * Math.cos(a), HELIX.z + HELIX.r * Math.sin(a), f * level * FLOOR_H]);
  }
  return pts;
}

// Tushish rampasi: g'arbiy chetdan (shimolga qarab) kirib, har aylanishda bir qavat pastlaydi
function helixDownPts(level) {
  const pts = [];
  const steps = level * 24;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = f * level * Math.PI * 2;
    pts.push([HELIX_DOWN.x + HELIX_DOWN.r * Math.cos(a), HELIX_DOWN.z + HELIX_DOWN.r * Math.sin(a), (1 - f) * level * FLOOR_H]);
  }
  return pts;
}

// Yo'lak bo'ylab joyga yaqinlashib, oldi bilan kirish (from: 1 — g'arbdan, -1 — sharqdan)
function intoStall(st, from) {
  const y = st.y;
  return [[st.x - from * 2.4, st.laneZ, y], [st.x - from * 0.8, st.laneZ + st.toward * 0.9, y], [st.x, st.z - st.toward * 1.0, y], [st.x, st.z, y]];
}
// Joydan orqaga chiqib, yo'lakda yurishga tayyor turish (dir: 1 — sharqqa, -1 — g'arbga)
function outOfStall(st, dir) {
  const y = st.y;
  return [[st.x, st.z, y], [st.x, st.z - st.toward * 1.2, y], [st.x - dir * 0.6, st.laneZ + st.toward * 0.5, y], [st.x - dir * 1.8, st.laneZ, y]];
}

const DRIVEWAY_IN = [[STOP_IN, LANE_IN], [2.5, LANE_IN], [6.4, -3.3], [8.8, -5.0], [10.2, -7.4], [G.xL, -9.6]];
const DRIVEWAY_OUT = [[G.xL, -9.6], [10.2, -7.4], [9.4, -5.4], [9.5, -2.4], [9.8, 0.2], [9.2, 2.5], [7.4, LANE_OUT], [STOP_OUT, LANE_OUT]];
const RAMP_UP = [[G.xR - 1.0, G.lane1], [G.xR, G.lane1 - 1.0], [HELIX.x - HELIX.r + 0.2, HELIX.z + 1.6]];

// Shlagbaumdan → garaj → (kerak bo'lsa spiral rampa bo'ylab o'z qavatiga) → aynan o'z joyiga
function enterMotion(st) {
  const pts = [...DRIVEWAY_IN];
  const y = st.y;
  if (st.level === 0) {
    if (st.laneZ === G.lane1) pts.push([G.xL + 0.3, G.lane1 + 1.0], [G.xL + 1.4, G.lane1]);
    else pts.push([G.xL, G.lane2 + 1.2], [G.xL + 1.4, G.lane2]);
    pts.push(...intoStall(st, 1));
  } else {
    // 1-qavat yo'lagi bo'ylab sharqqa → rampa → yuqori qavat, sharqiy chetdan 2-yo'lakka
    pts.push([G.xL + 0.3, G.lane1 + 1.0], [G.xL + 1.4, G.lane1], ...RAMP_UP, ...helixPts(st.level).slice(0, -1));
    pts.push([HELIX.x - HELIX.r, HELIX.z, y], [G.xR + 0.2, G.lane2 + 1.4, y], [G.xR - 1.0, G.lane2, y]);
    if (st.laneZ === G.lane2) pts.push(...intoStall(st, -1));
    else pts.push([G.xL + 1.2, G.lane2, y], [G.xL, G.lane2 + 1.2, y], [G.xL, G.lane1 - 1.0, y], [G.xL + 1.4, G.lane1, y], ...intoStall(st, 1));
  }
  return makeMotion([{ pts, speed: 3.6 }]);
}

// O'z joyidan orqaga chiqish → (yuqori qavatda spiral rampa bo'ylab tushish) → garaj chiqishi → chiqish shlagbaumi
function exitMotion(st) {
  const y = st.y;
  if (st.level === 0) {
    const back = outOfStall(st, -1); // g'arbga — chiqish yo'li tomonga
    const pts = [back.at(-1)];
    if (st.laneZ === G.lane1) pts.push([G.xL + 1.4, G.lane1], [G.xL, G.lane1 + 1.0]);
    else pts.push([G.xL + 1.4, G.lane2], [G.xL, G.lane2 + 1.2], [G.xL, G.lane1]);
    pts.push(...DRIVEWAY_OUT);
    return makeMotion([{ pts: back, reverse: true, speed: 1.6 }, { pts, speed: 3.6 }]);
  }
  // yuqori qavat: 2-yo'lak bo'ylab g'arbga → tushish rampasi → 1-qavatda shimolga → chiqish yo'li
  const dir = st.laneZ === G.lane2 ? -1 : 1;
  const back = outOfStall(st, dir);
  const pts = [back.at(-1)];
  if (st.laneZ === G.lane1) pts.push([G.xR - 1.4, G.lane1, y], [G.xR, G.lane1 - 1.0, y], [G.xR, G.lane2 + 1.2, y], [G.xR - 1.4, G.lane2, y]);
  pts.push([G.xL + 1.4, G.lane2, y], [G.xL, G.lane2 + 1.4, y], [HELIX_DOWN.x + HELIX_DOWN.r + 0.1, HELIX_DOWN.z - 1.5, y]);
  pts.push(...helixDownPts(st.level), [G.xL - 0.2, HELIX_DOWN.z + 2.2], [G.xL, G.lane1 + 1.0], ...DRIVEWAY_OUT);
  return makeMotion([{ pts: back, reverse: true, speed: 1.6 }, { pts, speed: 3.6 }]);
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
    ...idleCrew, car, done: t > end + 0.3, parked: true, detach: !!plan.motion && t > GO + 5.5, cam: t < 2.4 ? 'in' : null, moving: t > GO,
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
function buildLamp(scene, x, z, face, lit = true) {
  const metal = mat(0x50555c, { metalness: 0.7, roughness: 0.35 });
  scene.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 4.2, 10), metal, { x, y: 2.1, z }));
  scene.add(box(0.06, 0.06, 1.1, metal, { x, y: 4.2, z: z + face * 0.5 }));
  scene.add(box(0.22, 0.08, 0.42, metal, { x, y: 4.16, z: z + face * 1.05 }));
  scene.add(box(0.18, 0.02, 0.36, mat(0xfff1c8, { emissive: 0xfff1c8, emissiveIntensity: 2.5 }), { x, y: 4.11, z: z + face * 1.05, shadow: false }));
  if (!lit) return;
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

function buildWorld(scene, gate) {
  // Asfalt, maysa, trotuarlar
  const ground = mesh(new THREE.PlaneGeometry(900, 700), new THREE.MeshStandardMaterial({ map: grassTex([180, 140]), roughness: 1 }), { x: 80, z: 0, shadow: false });
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const road = mesh(new THREE.BoxGeometry(260, 0.02, ROAD_EDGE * 2), new THREE.MeshStandardMaterial({ map: asphaltTex([65, 2.4]), roughness: 0.92 }), { x: 80, y: 0.01, shadow: false });
  road.receiveShadow = true;
  scene.add(road);
  const white = mat(0xeceae4, { roughness: 0.8 });
  const yellow = mat(0xf2c230, { roughness: 0.7 });
  const curbMat = mat(0x8d8f93);
  const walk = (len) => new THREE.MeshStandardMaterial({ map: tileTex([len / 2, 1.1]), roughness: 0.85 });
  for (const [x0, x1] of [[-50, 210]]) {
    scene.add(box(x1 - x0, 0.16, 0.3, curbMat, { x: (x0 + x1) / 2, y: 0.08, z: ROAD_EDGE + 0.15 }));
    scene.add(box(x1 - x0, 0.12, 2.2, walk(x1 - x0), { x: (x0 + x1) / 2, y: 0.06, z: ROAD_EDGE + 1.4 }));
  }
  // -z tomonda trotuar maydon kirish yo'li (x 7,6..11) da uziladi
  for (const [x0, x1] of [[-50, 7.6], [11, 210]]) {
    scene.add(box(x1 - x0, 0.16, 0.3, curbMat, { x: (x0 + x1) / 2, y: 0.08, z: -ROAD_EDGE - 0.15 }));
    scene.add(box(x1 - x0, 0.12, 2.2, walk(x1 - x0), { x: (x0 + x1) / 2, y: 0.06, z: -ROAD_EDGE - 1.4 }));
  }
  // Yo'lak chiziqlari va stop chiziqlari
  for (const z of [-(ISLAND + 0.15), ISLAND + 0.15, -(ROAD_EDGE - 0.2), ROAD_EDGE - 0.2]) {
    for (let x = -49; x < 209; x += 2) scene.add(box(1.1, 0.01, 0.1, white, { x, y: 0.022, z, shadow: false }));
  }
  gate.add(box(0.3, 0.01, ROAD_EDGE - ISLAND, white, { x: -1.2, y: 0.023, z: -(ROAD_EDGE + ISLAND) / 2, shadow: false }));
  gate.add(box(0.3, 0.01, ROAD_EDGE - ISLAND, white, { x: 1.2, y: 0.023, z: (ROAD_EDGE + ISLAND) / 2, shadow: false }));
  // Yo'ldagi yozuvlar va o'qlar
  const inTex = textTexture('KIRISH  →', { font: 'bold 84px Arial' });
  const outTex = textTexture('←  CHIQISH', { font: 'bold 84px Arial' });
  gate.add(decal(inTex, 3.6, 0.9, -7, LANE_IN, 0));
  gate.add(decal(outTex, 3.6, 0.9, 7, LANE_OUT, 0));
  // Orolcha: bordyurli, ichida maysa, uchlari sariq-qora
  gate.add(box(13, 0.16, ISLAND * 2, mat(0x9a9c9f), { x: 0.5, y: 0.08 }));
  gate.add(box(12.4, 0.17, ISLAND * 2 - 0.4, new THREE.MeshStandardMaterial({ map: tileTex([6, 1.3]), roughness: 0.85 }), { x: 0.5, y: 0.085 }));
  for (const end of [-6, 7]) for (let i = 0; i < 6; i++) gate.add(box(0.2, 0.17, 0.5, i % 2 ? yellow : mat(0x15171a), { x: end, y: 0.09, z: -1.25 + i * 0.5 }));
  // Daraxtlar qatori (trotuar ortida) va butalar
  let seed = 1;
  for (const z of [-ROAD_EDGE - 3.4, ROAD_EDGE + 3.4]) {
    for (let x = -20; x <= 208; x += 4.2) {
      if (z < 0 && (Math.abs(x - 0.5) < 2 || x > 5)) continue; // budka ro'parasi va garaj oldi ochiq
      if (z > 0 && x > -10 && x < 30) continue; // darvoza kamerasi oldi ochiq
      scene.add(buildTree(x + Math.sin(seed) * 0.6, z + Math.cos(seed) * 0.4, 0.95 + (seed % 3) * 0.12, seed++));
    }
    for (let x = -19; x <= 127; x += 2.1) if (z > 0 || x < 6) scene.add(buildBush(x, z > 0 ? z - 1.2 : z + 1.2, 0.8 + (seed % 2) * 0.2, seed++));
  }
  for (const x of [-5.2, 6.2]) gate.add(buildBush(x, 0, 1, seed++)); // orolchadagi gulzor
  // Ko'cha chiroqlari ikki tomonda
  for (const x of [-12, -4, 4]) buildLamp(scene, x, -ROAD_EDGE - 0.6, 1);
  for (const x of [6, 14, 26, 40, 54, 68, 100, 116]) buildLamp(scene, x, ROAD_EDGE + 0.6, -1); // old tomonda — kamerani to'smaydigan joylarda
  // "P" belgisi kirishda
  const pTex = textTexture('P', { w: 128, h: 128, bg: '#2257d6', font: 'bold 96px Arial' });
  gate.add(box(0.08, 2.8, 0.08, mat(0x8a8f96), { x: -4.2, y: 1.4, z: -ROAD_EDGE - 0.6 }));
  gate.add(mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: pTex }), { x: -4.2, y: 2.85, z: -ROAD_EDGE - 0.55 }));

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
    gate.add(box(0.08, 2.4, 0.08, mat(0x8a8f96), { x: -6.2, y: 1.2, z: -ROAD_EDGE - 0.6 }));
    const board = mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }), { x: -6.2, y: 2.25, z: -ROAD_EDGE - 0.55 });
    gate.add(board);
    // Yo'l yuzasidagi bo'yalgan belgi (kirish yo'lagida)
    gate.add(decal(tex, 1.1, 1.38, -10, LANE_IN, Math.PI / 2));
  }

  // Raqam kameralari (past ustun, mashinaga qaragan)
  for (const [p, face] of [[CAM_IN, -1], [CAM_OUT, 1]]) {
    gate.add(box(0.07, p.y, 0.07, mat(0x6f7378), { x: p.x, y: p.y / 2 + 0.15, z: p.z }));
    const cam = box(0.28, 0.12, 0.12, mat(0xe9eaec), { x: p.x, y: p.y + 0.2, z: p.z });
    cam.rotation.y = face < 0 ? -0.45 : Math.PI - 0.45;
    cam.add(box(0.03, 0.07, 0.07, mat(0x111111, { emissive: 0x223355, emissiveIntensity: 0.6 }), { x: -0.15 }));
    gate.add(cam);
  }

  buildBooth(gate);
  return [buildBarrier(gate, -1), buildBarrier(gate, 1)];
}

// ---------- Garaj binosi: beton plitalar, ustunlar, panjaralar, alyumin qanotlar, spiral rampa, tom bog'i ----------
// Har zona polida — chizilgan joylar va raqamlar (A-01 ...); VIP A — oltin chiziqlar, nogironlar joyi — ko'k
function zoneFloorTex(zone) {
  return canvasTex(1024, 1040, (c, w, h) => {
    const sx = w / (10 * PITCH);
    const cy = (z) => (z - G.zB) * (h / (G.zF - G.zB)); // kanvas tepasi — garajning orqa cheti
    c.fillStyle = zone === 'A' ? '#3a3a3e' : '#4a4d53';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    const line = zone === 'A' ? '#f2c230' : '#eceae4';
    c.textAlign = 'center';
    ROWS_Z.forEach((z, r) => {
      const toward = r % 2 === 0 ? 1 : -1;
      for (let k = 0; k < 10; k++) {
        const x0 = k * PITCH * sx;
        if (zone !== 'A' && zone !== 'E' && r === 0 && k < 2) { // nogironlar joyi
          c.fillStyle = 'rgba(30,91,216,.55)';
          c.fillRect(x0 + 3, cy(z - 1.3), PITCH * sx - 6, cy(z + 1.3) - cy(z - 1.3));
        }
        c.strokeStyle = line;
        c.lineWidth = 5;
        c.strokeRect(x0 + 3, cy(z - 1.3), PITCH * sx - 6, cy(z + 1.3) - cy(z - 1.3));
        c.fillStyle = line;
        c.font = 'bold 28px Arial';
        c.fillText(`${zone}-${String(r * 10 + k + 1).padStart(2, '0')}`, x0 + (PITCH * sx) / 2, cy(z - toward * 1.05) + 10);
      }
    });
    // yo'lakda katta zona harfi va harakat o'qlari
    c.fillStyle = 'rgba(242,194,48,.85)';
    c.font = 'bold 90px Arial';
    c.fillText(zone, w / 2, cy(G.lane2) + 32);
    c.font = 'bold 54px Arial';
    c.fillText('→        →        →', w / 2, cy(G.lane1) + 18);
  });
}

function buildGarage(scene) {
  const W = G.x1 - G.x0;
  const cx = (G.x0 + G.x1) / 2;
  const cz = (G.zF + G.zB) / 2;
  const D = G.zF - G.zB + 0.4;
  // Har qavat — alohida guruh: mashina yuqori qavat ostida bo'lsa, ustki qavatlar "shaffof kesim" bo'lib ochiladi
  const levels = [0, 1, 2].map(() => ({ group: new THREE.Group(), mats: [], fade: 1 }));
  for (const L of levels) scene.add(L.group);
  const fading = (lv, m) => {
    levels[lv].mats.push(m);
    return m;
  };
  const add = (lv, obj, fades = true) => {
    obj.userData.fades = fades;
    levels[lv].group.add(obj);
    return obj;
  };
  const m4 = new THREE.Matrix4();
  for (let lv = 0; lv < 3; lv++) {
    const slab = fading(lv, mat(0xbdbab3, { roughness: 0.8 }));
    // pol: 1-qavatda — yerdagi beton, yuqorida — qalin plita
    if (lv === 0) add(0, mesh(new THREE.BoxGeometry(W, 0.08, D), slab, { x: cx, y: 0.04, z: cz, shadow: false })).receiveShadow = true;
    else add(lv, mesh(new THREE.BoxGeometry(W, 0.3, D), slab, { x: cx, y: lv * FLOOR_H - 0.15, z: cz }));
    // zona pollari (chizilgan joylar)
    for (const [zone, [zl, bx]] of Object.entries(ZONE_POS)) {
      if (zl !== lv) continue;
      const p = mesh(new THREE.PlaneGeometry(10 * PITCH, G.zF - G.zB), fading(lv, new THREE.MeshStandardMaterial({ map: zoneFloorTex(zone), roughness: zone === 'A' ? 0.18 : 0.75, metalness: zone === 'A' ? 0.35 : 0 })), { x: bx + 5 * PITCH, y: lv * FLOOR_H + 0.09, z: cz, shadow: false });
      p.rotation.x = -Math.PI / 2;
      p.receiveShadow = true;
      add(lv, p);
    }
    // ustunlar shu qavatning shipini ko'taradi (tomda yo'q): joylar chegarasida, oldi/o'rta/orqa qatorlarda
    if (lv < 2) {
      const at = [];
      for (const z of [G.zF - 0.25, -16.9, G.zB + 0.25]) for (const bx of [11.8, 29.3]) for (let k = 0; k <= 10; k += 2) at.push([bx + k * PITCH, z]);
      const cols = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, FLOOR_H - 0.3, 0.4), slab, at.length);
      at.forEach(([x, z], i) => cols.setMatrixAt(i, m4.makeTranslation(x, lv * FLOOR_H + (FLOOR_H - 0.3) / 2, z)));
      cols.castShadow = cols.receiveShadow = true;
      add(lv, cols);
    }
    if (lv > 0) {
      // panjaralar va oltin LED tasma; ship ostidagi yorug' chiziqlar (pastki qavatni yoritadi)
      const parapet = fading(lv, mat(0xe9e6df, { roughness: 0.6 }));
      const y = lv * FLOOR_H + 0.5;
      add(lv, box(W, 1.0, 0.18, parapet, { x: cx, y, z: G.zF + 0.1 }));
      add(lv, box(W, 1.0, 0.18, parapet, { x: cx, y, z: G.zB - 0.1 }));
      for (const [z0, z1] of [[G.zF + 0.2, -14.4], [-19.4, G.zB - 0.2]]) add(lv, box(0.18, 1.0, z0 - z1, parapet, { x: G.x0, y, z: (z0 + z1) / 2 }));
      add(lv, box(W, 0.05, 0.2, fading(lv, mat(0xf2c230, { emissive: 0xf2c230, emissiveIntensity: 1.2 })), { x: cx, y: y + 0.52, z: G.zF + 0.11, shadow: false }));
      const ceil = fading(lv, mat(0xfff6e0, { emissive: 0xfff6e0, emissiveIntensity: 1.6 }));
      for (const z of [G.lane1, G.lane2]) add(lv, box(W - 2, 0.04, 0.25, ceil, { x: cx, y: lv * FLOOR_H - 0.32, z, shadow: false }));
    }
  }
  for (const [x, y, z] of [[20, 2.6, -14], [38, 2.6, -19], [20, 5.8, -19], [38, 5.8, -14]]) {
    const l = new THREE.PointLight(0xfff1d6, 6, 16, 1.6);
    l.position.set(x, y, z);
    scene.add(l);
  }
  // old fasad: yuqori qavatlarda vertikal alyumin qanotlar (ichidagi mashinalar oralig'idan ko'rinadi)
  const fins = [];
  for (let x = G.x0 + 0.6; x < G.x1; x += 1.25) fins.push(x);
  const finMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, FLOOR_H + 1.3, 0.45), fading(1, mat(0xb8bcc2, { metalness: 0.8, roughness: 0.3 })), fins.length);
  fins.forEach((x, i) => finMesh.setMatrixAt(i, m4.makeTranslation(x, FLOOR_H - 0.2 + (FLOOR_H + 1.3) / 2, G.zF + 0.35)));
  finMesh.castShadow = true;
  add(1, finMesh);

  // Tom: quyosh panellari, bog' va chiroqlar (ular "kesim" paytida yashiriladi)
  const roofY = 2 * FLOOR_H;
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.06, 1.4), mat(0x1d2c4a, { metalness: 0.6, roughness: 0.25 }), 18);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0));
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 18; i++) {
    m4.compose(new THREE.Vector3(32 + (i % 6) * 2.9, roofY + 0.55, -10.6 - Math.floor(i / 6) * 2.6), q, one);
    panels.setMatrixAt(i, m4);
  }
  panels.castShadow = true;
  add(2, panels, false);
  add(2, mesh(new THREE.BoxGeometry(16, 0.3, 6.6), new THREE.MeshStandardMaterial({ map: grassTex([4, 2]), roughness: 1 }), { x: 39.5, y: roofY + 0.15, z: -21.6 }), false);
  let seed = 70;
  for (const x of [33, 37, 41, 45]) add(2, buildTree(x, -21.6, 0.6, seed++).translateY(roofY + 0.3), false);
  const roofLamps = new THREE.Group();
  roofLamps.position.y = roofY;
  for (const x of [15, 23]) buildLamp(roofLamps, x, -16.9, 1);
  add(2, roofLamps, false);

  // Har joy ustida yo'naltiruvchi chiroq: yashil — bo'sh, qizil — band, ko'k — nogironlar uchun (haqiqiy garajlardagidek)
  const sensors = [0, 1, 2].map((lv) => {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), lv < 2 ? 80 : 40);
    add(lv, im, false);
    return im;
  });
  const sensorAt = {};
  for (const zone of Object.keys(ZONE_POS)) {
    for (let n = 1; n <= 40; n++) {
      const st = stallFor(`${zone}-${String(n).padStart(2, '0')}`);
      const im = sensors[st.level];
      const i = (zone === 'B' || zone === 'D' ? 40 : 0) + n - 1;
      // tomda ship yo'q — chiroq past ustuncha ustida
      const y = st.level < 2 ? st.y + FLOOR_H - 0.55 : st.y + 1.1;
      im.setMatrixAt(i, m4.makeTranslation(st.x, y, st.z - st.toward * 1.15));
      im.setColorAt(i, new THREE.Color(0x2ee07a));
      sensorAt[st.label] = [im, i];
    }
  }

  // Ikki spiral rampa (har aylanish — bir qavat): sharqiy — yuqoriga, g'arbiy — pastga; tashqi devor, beton o'zak, yo'nalish belgisi
  const turns = 2;
  const coreH = turns * FLOOR_H + 1.4;
  for (const [h, a0, up] of [[HELIX, Math.PI, true], [HELIX_DOWN, 0, false]]) {
    const steps = 96;
    const road = [];
    const wall = [];
    const idx = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const a = a0 + f * turns * Math.PI * 2;
      const y = (up ? f : 1 - f) * turns * FLOOR_H + 0.06;
      for (const rr of [h.r - 1.6, h.r + 1.6]) road.push(h.x + rr * Math.cos(a), y, h.z + rr * Math.sin(a));
      const ro = h.r + 1.65;
      wall.push(h.x + ro * Math.cos(a), y, h.z + ro * Math.sin(a), h.x + ro * Math.cos(a), y + 1.0, h.z + ro * Math.sin(a));
      if (i < steps) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const ribbon = (arr, material) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, material);
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    scene.add(ribbon(road, mat(0x8f9196, { roughness: 0.9, side: THREE.DoubleSide })));
    scene.add(ribbon(wall, mat(0xe9e6df, { roughness: 0.6, side: THREE.DoubleSide })));
    scene.add(mesh(new THREE.CylinderGeometry(h.r - 1.7, h.r - 1.7, coreH, 32), mat(0xbdbab3, { roughness: 0.8 }), { x: h.x, y: coreH / 2, z: h.z }));
    const crown = mesh(new THREE.TorusGeometry(h.r - 1.65, 0.07, 8, 48), up ? mat(0xf2c230, { emissive: 0xf2c230, emissiveIntensity: 1.4 }) : mat(0x33e08b, { emissive: 0x33e08b, emissiveIntensity: 1.4 }), { x: h.x, y: coreH, z: h.z });
    crown.rotation.x = Math.PI / 2;
    scene.add(crown);
    const tex = textTexture(up ? 'P  ↑ KIRISH' : '↓ CHIQISH', { w: 512, h: 160, bg: up ? '#2257d6' : '#1f8a4c', font: 'bold 64px Arial' });
    const sign = mesh(new THREE.PlaneGeometry(3, 0.94), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.5 }), { x: h.x - 0.8, y: coreH - 1.1, z: h.z + h.r - 1.6, shadow: false });
    sign.rotation.y = -0.4;
    scene.add(sign);
  }
  // garajga kirish yo'li
  scene.add(mesh(new THREE.BoxGeometry(3.4, 0.022, 3.6), new THREE.MeshStandardMaterial({ map: asphaltTex([1, 1]), roughness: 0.92 }), { x: 9.9, y: 0.013, z: -6.4, shadow: false }));

  // Kirishdagi jonli LED tablo: har qavatda nechta bo'sh joy
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 384;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  scene.add(box(0.16, 3.0, 0.16, mat(0x50555c, { metalness: 0.7 }), { x: 7.4, y: 1.5, z: -6.9 }));
  const board = mesh(new THREE.BoxGeometry(1.9, 1.45, 0.12), [mat(0x1b1d21), mat(0x1b1d21), mat(0x1b1d21), mat(0x1b1d21),
    new THREE.MeshStandardMaterial({ map: boardTex, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 1 }), mat(0x1b1d21)], { x: 7.4, y: 3.4, z: -6.9 });
  board.rotation.y = -0.55;
  scene.add(board);
  const drawBoard = (free) => {
    const c = boardCanvas.getContext('2d');
    c.fillStyle = '#0b0d10';
    c.fillRect(0, 0, 512, 384);
    c.fillStyle = '#2257d6';
    c.fillRect(0, 0, 512, 84);
    c.fillStyle = '#fff';
    c.font = 'bold 56px Arial';
    c.textAlign = 'center';
    c.fillText('P  BO\'SH JOYLAR', 256, 62);
    c.font = 'bold 50px monospace';
    ['1-qavat', '2-qavat', '3-qavat'].forEach((t, i) => {
      c.textAlign = 'left';
      c.fillStyle = '#f2c230';
      c.fillText(t, 26, 160 + i * 90);
      c.textAlign = 'right';
      c.fillStyle = free[i] > 0 ? '#33e08b' : '#ff4d4f';
      c.fillText(free[i] > 0 ? String(free[i]) : "TO'LA", 486, 160 + i * 90);
    });
    boardTex.needsUpdate = true;
  };
  drawBoard([80, 80, 40]);

  // ---------- VIP A: alohida dunyo — shisha devorchalar, oltin ship, peshtoq, kirish ramkasi ----------
  const A0 = ZONE_POS.A[1];
  const A1 = A0 + 10 * PITCH;
  const glassP = new THREE.MeshPhysicalMaterial({ color: 0xd9c48a, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
  const gold = mat(0xd4a93a, { metalness: 0.9, roughness: 0.25 });
  // joylar orasida shisha devorchalar (oltin tutqichli)
  const divAt = [];
  for (const z of ROWS_Z) for (let k = 1; k < 10; k++) divAt.push([A0 + k * PITCH, z]);
  const divs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 1.1, 2.0), glassP, divAt.length);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.05, 2.0), gold, divAt.length);
  divAt.forEach(([x, z], i) => {
    divs.setMatrixAt(i, m4.makeTranslation(x, 0.6, z));
    rails.setMatrixAt(i, m4.makeTranslation(x, 1.17, z));
  });
  add(0, divs, false);
  add(0, rails, false);
  // B zonasidan ajratuvchi shisha devor (yo'laklar ochiq qoladi)
  for (const [z0, z1] of [[G.zF, -10.6], [-14.0, -19.8], [-23.2, G.zB]]) {
    add(0, mesh(new THREE.BoxGeometry(0.06, FLOOR_H - 0.35, z0 - z1), glassP, { x: A1 + 0.05, y: (FLOOR_H - 0.35) / 2, z: (z0 + z1) / 2, shadow: false }), false);
    add(0, box(0.1, 0.08, z0 - z1, gold, { x: A1 + 0.05, y: FLOOR_H - 0.38, z: (z0 + z1) / 2, shadow: false }), false);
  }
  // oltin nurli ship paneli va yo'lak bo'ylab oltin chiroqlar
  const warm = mat(0xffd98a, { emissive: 0xffc861, emissiveIntensity: 1.5 });
  for (const z of [-9.3, -15.3, -18.5, -24.5]) add(0, box(10 * PITCH - 0.4, 0.04, 1.4, warm, { x: (A0 + A1) / 2, y: FLOOR_H - 0.33, z, shadow: false }), false);
  for (const z of [G.lane1, G.lane2]) add(0, box(10 * PITCH, 0.02, 0.12, mat(0xf2c230, { emissive: 0xf2c230, emissiveIntensity: 1.6 }), { x: (A0 + A1) / 2, y: 0.1, z: z + 1.6, shadow: false }), false);
  for (const x of [A0 + 4, A1 - 4]) {
    const l = new THREE.PointLight(0xffd08a, 7, 12, 1.5);
    l.position.set(x, FLOOR_H - 0.6, -16.9);
    scene.add(l);
  }
  // kirish ramkasi va "VIP" peshtoqi (old tomonda, yo'lga qaragan)
  const premTex = canvasTex(1024, 192, (c, w, h) => {
    c.fillStyle = '#121316';
    c.fillRect(0, 0, w, h);
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#fff3c2');
    grd.addColorStop(0.5, '#f2c230');
    grd.addColorStop(1, '#a8770a');
    c.fillStyle = grd;
    c.font = 'bold 130px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('♛  V I P  ♛', w / 2, h / 2 + 8);
    c.strokeStyle = '#f2c230';
    c.lineWidth = 6;
    c.strokeRect(10, 10, w - 20, h - 20);
  });
  premTex.wrapS = premTex.wrapT = THREE.ClampToEdgeWrapping;
  add(0, mesh(new THREE.PlaneGeometry(7.2, 1.35), new THREE.MeshStandardMaterial({ map: premTex, emissive: 0xffffff, emissiveMap: premTex, emissiveIntensity: 0.85 }), { x: (A0 + A1) / 2, y: FLOOR_H - 0.95, z: G.zF + 0.32, shadow: false }), false);
  for (const x of [A0 - 0.05, A1 + 0.05]) add(0, box(0.22, FLOOR_H - 0.3, 0.22, gold, { x, y: (FLOOR_H - 0.3) / 2, z: G.zF + 0.2 }), false);
  // elektromobil quvvatlagichlari — orqa qatordagi joylar orasida
  for (let k = 1; k < 10; k += 2) {
    add(0, box(0.22, 1.2, 0.16, mat(0xf4f3ef, { roughness: 0.4 }), { x: A0 + k * PITCH, y: 0.6, z: G.zB + 0.12 }), false);
    add(0, box(0.16, 0.2, 0.02, mat(0x33e08b, { emissive: 0x33e08b, emissiveIntensity: 1.6 }), { x: A0 + k * PITCH, y: 0.95, z: G.zB + 0.21, shadow: false }), false);
  }
  // VIP qulayliklari tablosi: VIP va B zonasi chegarasida, yo'lga qaragan
  const perksTex = canvasTex(512, 660, (c, w, h) => {
    c.fillStyle = '#121316';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#f2c230';
    c.lineWidth = 8;
    c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#f2c230';
    c.textAlign = 'center';
    c.font = 'bold 76px Georgia, serif';
    c.fillText('♛ VIP', w / 2, 92);
    c.font = 'bold 30px Arial';
    c.fillText('QULAYLIKLARI', w / 2, 134);
    c.textAlign = 'left';
    c.font = '27px Arial';
    VIP_PERKS.forEach(([text], i) => {
      const y = 200 + i * 74;
      c.fillStyle = '#f2c230';
      c.fillText('✦', 30, y);
      c.fillStyle = '#f4ecd8';
      const lines = [''];
      for (const word of text.split(' ')) {
        const tryLine = lines.at(-1) ? `${lines.at(-1)} ${word}` : word;
        if (c.measureText(tryLine).width > 420 && lines.at(-1)) lines.push(word);
        else lines[lines.length - 1] = tryLine;
      }
      lines.slice(0, 2).forEach((ln, k) => c.fillText(ln, 66, y + k * 31));
    });
  });
  perksTex.wrapS = perksTex.wrapT = THREE.ClampToEdgeWrapping;
  scene.add(box(0.12, 2.2, 0.12, gold, { x: A1 + 0.9, y: 1.1, z: -7.5 }));
  const perks = mesh(new THREE.BoxGeometry(1.7, 2.2, 0.1), [gold, gold, gold, gold, new THREE.MeshStandardMaterial({ map: perksTex, emissive: 0xffffff, emissiveMap: perksTex, emissiveIntensity: 0.7 }), gold], { x: A1 + 0.9, y: 2.6, z: -7.5 });
  perks.rotation.y = -0.35;
  scene.add(perks);

  // ---------- Zona belgisi: tanlangan zona atrofida yonib turuvchi oltin ramka va yozuv ----------
  const marker = new THREE.Group();
  const glow = new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.9, depthWrite: false });
  const mw = 10 * PITCH + 0.3;
  const md = G.zF - G.zB + 0.2;
  for (const [w, d, x, z] of [[mw, 0.4, 0, md / 2], [mw, 0.4, 0, -md / 2], [0.4, md, mw / 2, 0], [0.4, md, -mw / 2, 0]]) marker.add(mesh(new THREE.BoxGeometry(w, 0.35, d), glow, { x, y: 0.17, z, shadow: false }));
  const fill = mesh(new THREE.PlaneGeometry(mw, md), new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.12, depthWrite: false }), { y: 0.02, shadow: false });
  fill.rotation.x = -Math.PI / 2;
  marker.add(fill);
  const tagCanvas = document.createElement('canvas');
  tagCanvas.width = 512;
  tagCanvas.height = 160;
  const tagTex = new THREE.CanvasTexture(tagCanvas);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthTest: false, transparent: true }));
  tag.scale.set(9.6, 3, 1);
  tag.position.y = 3.4;
  tag.renderOrder = 10;
  marker.add(tag);
  marker.visible = false;
  scene.add(marker);
  const showZone = (zone) => {
    const [lv, bx] = ZONE_POS[zone];
    marker.position.set(bx + 5 * PITCH, lv * FLOOR_H + 0.14, cz);
    const c = tagCanvas.getContext('2d');
    c.clearRect(0, 0, 512, 160);
    c.fillStyle = zone === 'A' ? 'rgba(18,19,22,.92)' : 'rgba(34,87,214,.92)';
    c.beginPath();
    c.roundRect(6, 6, 500, 148, 28);
    c.fill();
    c.strokeStyle = '#f2c230';
    c.lineWidth = 6;
    c.stroke();
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.font = 'bold 64px Arial';
    c.fillText(zone === 'A' ? '♛ VIP zona' : `Zona ${zone}`, 256, 78);
    c.font = '36px Arial';
    c.fillStyle = '#f2c230';
    c.fillText(`${lv + 1}-qavat${lv === 2 ? ' (ochiq tom)' : ''}`, 256, 128);
    tagTex.needsUpdate = true;
    return { x: bx + 5 * PITCH, y: lv * FLOOR_H, z: cz, level: lv };
  };
  // ---------- Har zonaning o'z kirishi: ikkala yo'lakda shlagbaumli darvoza va "B zona — kirish" peshtoqi ----------
  // 1-qavatda mashinalar g'arbdan (darvozadan) keladi, yuqori qavatlarda — sharqiy rampadan; darvoza shu tomonda turadi
  const armTex = canvasTex(256, 16, (c, w, h) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 ? '#d63a3a' : '#f4f3ef';
      c.fillRect(i * 32, 0, 32, h);
    }
  }, [1, 1]);
  const gates = [];
  const GATE_AT = { A: [0, ZONE_POS.A[1], 1], B: [0, ZONE_POS.B[1], 1], C: [1, ZONE_POS.C[1] + 10 * PITCH, -1], D: [1, ZONE_POS.D[1] + 10 * PITCH, -1], E: [2, ZONE_POS.E[1] + 10 * PITCH, -1] };
  for (const [zone, [lv, gx, from]] of Object.entries(GATE_AT)) {
    const vip = zone === 'A';
    const postMat = fading(lv, mat(vip ? 0xd4a93a : 0x2a2d33, { metalness: 0.6, roughness: 0.35 }));
    const armMat = fading(lv, new THREE.MeshStandardMaterial({ map: armTex, roughness: 0.5 }));
    const boxMat = fading(lv, mat(0xf2c230, { roughness: 0.5 }));
    const tex = textTexture(vip ? '♛  A zona · kirish' : zone + ' zona · kirish', { w: 512, h: 96, bg: vip ? '#121316' : '#1d4fc4', fg: vip ? '#f2c230' : '#ffffff', font: 'bold 52px Arial' });
    const signMat = fading(lv, new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.5 }));
    for (const laneZ of [G.lane1, G.lane2]) {
      const g = new THREE.Group();
      g.position.set(gx, lv * FLOOR_H, laneZ);
      for (const dz of [-1.75, 1.75]) g.add(box(0.12, 2.5, 0.12, postMat, { y: 1.25, z: dz }));
      g.add(box(0.12, 0.12, 3.62, postMat, { y: 2.5 }));
      const sign = mesh(new THREE.PlaneGeometry(3.3, 0.6), signMat, { x: -from * 0.08, y: 2.15, shadow: false });
      sign.rotation.y = from > 0 ? -Math.PI / 2 : Math.PI / 2; // kelayotgan mashinaga qaragan
      g.add(sign);
      g.add(box(0.28, 0.95, 0.28, boxMat, { x: -from * 0.3, y: 0.48, z: -1.6 })); // shlagbaum qutisi
      const pivot = new THREE.Group();
      pivot.position.set(-from * 0.3, 0.95, -1.6);
      const arm = box(0.08, 0.08, 3.3, armMat, { z: 1.65, shadow: false });
      pivot.add(arm);
      g.add(pivot);
      add(lv, g);
      gates.push({ pivot, x: gx, y: lv * FLOOR_H, z: laneZ, open: 0 });
    }
  }
  return { levels, drawBoard, sensorAt, marker, showZone, gates };
}

// Ikki qorovul: budkadagi — keksaroq, yashil forma, oq mo'ylov; tashqaridagi — yosh, ko'k forma, jilet
const GUARD_SEATED = { uniform: 0x2f4a3a, cap: 0x23362b, skin: 0xd9a77e, mustache: 0xd8d8d8, vest: false, girth: 1.15, brows: 0xbfbfbf };
const GUARD_OUTSIDE = { uniform: 0x24448f, cap: 0x1b2a55, skin: 0xe8b98f, mustache: null, vest: true, girth: 1, brows: 0x3a2a20 };

export default function Gate3D({ event, arrival, reject, release, spots, focusZone, onPlateRead }) {
  const mount = useRef(null);
  const bubble = useRef(null);
  const camBox = useRef(null);
  // Ikki mustaqil yo'lak: kirish (kelish, kirish) va chiqish (chiqish, haydash) — har birida o'z navbati va mashinasi
  const queue = useRef({ in: [], out: [] });
  const current = useRef({ in: null, out: null }); // { fn, t, ev, read }
  const [big, setBig] = useState(false); // butun ekran
  const [freeCam, setFreeCam] = useState(false); // foydalanuvchi kamerani o'zi boshqaryapti
  const autoCam = useRef(false); // "Avtomatik kamera" bosildi
  const onRead = useRef(onPlateRead);
  useEffect(() => { onRead.current = onPlateRead; }, [onPlateRead]);
  // Garajdagi mashinalar — real bandlik: animIn — hali yo'lda (joyida ko'rsatilmaydi), pendingOut — chiqish navbatida (joyida turadi)
  const spotsRef = useRef(spots);
  const syncReq = useRef(true);
  const animIn = useRef(new Set());
  const pendingOut = useRef(new Set());
  const parkedRef = useRef(new Map()); // label → { car, plate, goneAt }
  const focusReq = useRef(null); // qorovul zona tugmasini bosdi — 3D shu zonani ko'rsatadi
  const prevZone = useRef(focusZone); // boshlang'ich zona ko'rsatilmaydi — faqat qorovul almashtirganda
  useEffect(() => {
    if (focusZone && focusZone !== prevZone.current) focusReq.current = focusZone;
    prevZone.current = focusZone;
  }, [focusZone]);
  useEffect(() => {
    spotsRef.current = spots;
    syncReq.current = true;
  }, [spots]);

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
    scene.fog = new THREE.Fog(0xd8d3c8, 110, 380);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    renderer.toneMappingExposure = 1.05;
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 700);
    const plateCam = new THREE.PerspectiveCamera(12, 16 / 10, 0.1, 40); // tor burchakli raqam kamerasi

    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30343a, 1.3));
    const sun = new THREE.DirectionalLight(0xffe7c4, 2.6); // past quyosh — uzun soyalar
    sun.position.set(-42, 84, 76);
    sun.target.position.set(30, 0, -8);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 70, bottom: -70, far: 260 });
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const barriers = buildWorld(scene, scene);
    const garage = buildGarage(scene);

    // To'xtab turgan mashinalar (yengil model) — serverdagi band joylar bilan bir xil
    const parked = parkedRef.current;
    parked.clear();
    const removeParked = (label) => {
      const p = parked.get(label);
      if (!p) return;
      p.car.parent?.remove(p.car);
      parked.delete(label);
    };
    const addParked = (s) => {
      const st = stallFor(s.label);
      if (!st) return;
      const car = buildParkedCar(shapeFor(brandFor(s.plate, s.zone === 'A')), paintFor(s.plate));
      car.position.set(st.x, st.y, st.z);
      car.rotation.y = st.rot;
      garage.levels[st.level].group.add(car);
      parked.set(s.label, { car, plate: s.plate, goneAt: null });
    };
    const parkedLabel = (ev) => (ev.label && parked.has(ev.label) ? ev.label : [...parked].find(([, p]) => p.plate === ev.plate)?.[0] ?? ev.label);
    const SENSOR = { free: new THREE.Color(0x2ee07a), busy: new THREE.Color(0xff3b3b), acc: new THREE.Color(0x3b82ff), off: new THREE.Color(0x555a60) };
    const sync = (time) => {
      const list = spotsRef.current || [];
      const busy = new Map(list.filter((s) => s.is_busy && s.plate).map((s) => [s.label, s]));
      for (const [label, p] of parked) {
        const s = busy.get(label);
        if (animIn.current.has(label) || (s && s.plate !== p.plate)) removeParked(label);
        else if (s || pendingOut.current.has(label)) p.goneAt = null;
        else if (p.goneAt === null) p.goneAt = time + 2.5; // chiqish voqeasi bazadan biroz kechikib kelishi mumkin
        else if (time > p.goneAt) removeParked(label);
      }
      for (const [label, s] of busy) if (!parked.has(label) && !animIn.current.has(label)) addParked(s);
      const free = [0, 0, 0];
      for (const s of list) {
        const sensor = garage.sensorAt[s.label];
        if (!sensor) continue;
        const taken = s.is_busy || animIn.current.has(s.label);
        if (!taken && !s.is_disabled) free[ZONE_POS[s.zone][0]]++;
        sensor[0].setColorAt(sensor[1], s.is_disabled ? SENSOR.off : taken ? SENSOR.busy : s.is_accessible ? SENSOR.acc : SENSOR.free);
        sensor[0].instanceColor.needsUpdate = true;
      }
      if (list.length) garage.drawBoard(free);
      placeWashers();
    };
    const WASHER = { uniform: 0xf2c230, cap: 0x1b1d21, skin: 0xd9a77e, mustache: null, vest: false, girth: 1, brows: 0x2a1d14 };
    const washers = [0, 1].map(() => {
      const w = buildGuard(WASHER);
      w.scale.setScalar(0.95);
      w.visible = false;
      scene.add(w);
      return w;
    });
    const placeWashers = () => {
      const premium = [...parked.keys()].filter((l) => l.startsWith('A-')).sort();
      washers.forEach((w, i) => {
        const st = stallFor(premium[Math.floor((i * premium.length) / 2)]);
        w.visible = !!st && premium.length > i;
        if (!st) return;
        w.position.set(st.x + 0.85, 0.02, st.z + st.toward * 0.2);
        w.rotation.y = Math.PI; // mashinaga qaragan
      });
    };
    let focus = null;
    let tourT = 0;
    const camOff = GATE_VIEW[1].clone();
    const offGoal = new THREE.Vector3();
    const transits = []; // shlagbaumdan o'tib, o'z joyiga ketayotgan mashinalar — yo'lak keyingi mashinaga bo'shaydi
    let nextSync = 0;
    let cutLevel = null;
    let cutUntil = 0;
    const camTarget = new THREE.Vector3(13, 2.6, -9.5);
    // Erkin kamera: chap tugma — aylantirish, o'ng — surish, g'ildirak — yaqinlashtirish, strelkalar (sahna tanlanganda) — surish.
    // Foydalanuvchi tegsa avtomatik kamera to'xtaydi; 45 s tegmasa yoki "Avtomatik kamera" bosilsa qaytadi.
    const controls = new OrbitControls(camera, renderer.domElement);
    Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: Math.PI * 0.48, minDistance: 6, maxDistance: 320, keyPanSpeed: 30, screenSpacePanning: false });
    renderer.domElement.tabIndex = 0;
    controls.listenToKeyEvents(renderer.domElement);
    let free = false;
    let lastTouch = 0;
    const takeOver = () => {
      lastTouch = performance.now();
      if (free) return;
      free = true;
      setFreeCam(true);
    };
    controls.addEventListener('start', takeOver);
    controls.addEventListener('change', () => free && (lastTouch = performance.now()));
    renderer.domElement.addEventListener('keydown', (e) => e.key.startsWith('Arrow') && takeOver());
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
          const out = ev.type === 'exit' || ev.type === 'expel';
          const label = out ? parkedLabel(ev) : ev.label;
          if (out) {
            removeParked(label);
            pendingOut.current.delete(label);
          }
          if (still && ev.type === 'enter') animIn.current.delete(label);
          syncReq.current = true;
          if (!still) {
            let plan = {};
            const stall = stallFor(label);
            if (ev.type === 'enter') plan = { stall, motion: stall ? enterMotion(stall) : makeMotion([{ pts: DRIVEWAY_IN, speed: 3.6 }]) };
            else if (out && stall) plan = { stall, motion: exitMotion(stall) };
            current.current[lane] = { fn: SCENES[ev.type], t: 0, ev, read: false, plan };
            // markaga mos kuzov turi (sedan / suv / sport)
            const type = shapeFor(brandFor(ev.plate, stall?.zone === 'A'));
            if (cars[lane].userData.type !== type) {
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
        driveCar(car, st.car.x, st.car.z, dt, st.car.y ?? 0, st.car.pitch ?? 0);
        // Mashina to'xtagach kamera raqamni "aniqlaydi"
        if (st.hold && cur.t > 3.2 && !cur.read) {
          cur.read = true;
          onRead.current?.(cur.ev.plate);
        }
        if (st.detach) {
          // shlagbaum yopildi: mashina o'z yo'lida davom etadi, darvoza keyingisini kutadi
          transits.push({ car, plan: cur.plan, t: cur.t });
          current.current[lane] = null;
          cars[lane] = buildCar();
          cars[lane].visible = false;
          scene.add(cars[lane]);
        } else if (st.done) {
          current.current[lane] = null;
          car.visible = false;
          if (st.parked && cur.plan.stall) animIn.current.delete(cur.plan.stall.label);
          syncReq.current = true;
        }
        states[lane] = { ...st, lane, plate: cur.ev.plate };
      }

      // Joyiga ketayotgan mashinalar; yetib borgach yengil modelga almashadi (sinxronlash shu kadrda)
      for (let i = transits.length - 1; i >= 0; i--) {
        const tr = transits[i];
        tr.t += dt;
        const k = tr.t - GO;
        const p = tr.plan.motion.at(k);
        tr.car.rotation.y = p.rot;
        driveCar(tr.car, p.x, p.z, dt, p.y, p.pitch);
        if (k > tr.plan.motion.total + 0.4) {
          scene.remove(tr.car);
          transits.splice(i, 1);
          if (tr.plan.stall) animIn.current.delete(tr.plan.stall.label);
          syncReq.current = true;
        }
      }
      if (syncReq.current || time > nextSync) {
        syncReq.current = false;
        nextSync = time + 0.5;
        sync(time);
      }

      for (const w of washers) if (w.visible) poseGuard(w, 'wave', time, dt, null);
      if (focusReq.current) {
        focus = { ...garage.showZone(focusReq.current), until: time + 7 };
        focusReq.current = null;
        garage.marker.visible = true;
      }
      if (focus && time > focus.until) {
        focus = null;
        garage.marker.visible = false;
      }
      if (focus) for (const c of garage.marker.children) c.material.opacity = (c.isSprite ? 1.4 : c.geometry.type === 'PlaneGeometry' ? 0.22 : 1.2) * (0.6 + 0.4 * Math.sin(time * 5));

      // Zona darvozalari: yonida harakatlanayotgan mashina bo'lsa shlagbaum ko'tariladi, o'tib ketgach tushadi
      const gateCars = [cars.in, cars.out, ...transits.map((tr) => tr.car)].filter((c) => c.visible);
      for (const gt of garage.gates) {
        const near = gateCars.some((c) => Math.abs(c.position.y - gt.y) < 1.5 && Math.abs(c.position.x - gt.x) < 5.5 && Math.abs(c.position.z - gt.z) < 2.6);
        gt.open += ((near ? 1 : 0) - gt.open) * Math.min(1, dt * 4);
        gt.pivot.rotation.x = -gt.open * 1.35;
      }

      // Garaj "kesimi": mashina pastki qavatda yursa, ustidagi qavatlar shaffof bo'lib, ichkari ko'rinadi
      const mover = (states.in?.moving && cars.in.visible && cars.in) || transits.at(-1)?.car || (states.out?.moving && cars.out.visible && cars.out) || null;
      const mp = mover?.position;
      if (mp && mp.x > G.x0 - 0.5 && mp.x < G.x1 + 0.3 && mp.z < G.zF + 0.5 && mp.z > G.zB - 0.5) {
        cutLevel = Math.round(mp.y / FLOOR_H);
        cutUntil = time + 1.8;
      } else if (time > cutUntil) cutLevel = null;
      if (focus) cutLevel = focus.level;
      for (const [lv, L] of garage.levels.entries()) {
        L.fade += ((cutLevel !== null && lv > cutLevel ? 0 : 1) - L.fade) * Math.min(1, dt * 3);
        const ghost = L.fade < 0.995;
        for (const m of L.mats) {
          if (m.transparent !== ghost) {
            m.transparent = ghost;
            m.depthWrite = !ghost;
            m.needsUpdate = true;
          }
          m.opacity = 0.12 + 0.88 * L.fade;
        }
        for (const c of L.group.children) if (!c.userData.fades) c.visible = L.fade > 0.55;
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


      // Kamera: savdo markazi, maydon va darvoza bir kadrda; harakatdagi mashinani yumshoq kuzatadi
      // Kamera: voqea bo'lsa — darvoza va mashina; bo'sh paytda sekin aylanib garaj, savdo markazi va parkni ko'rsatadi
      const busyNow = states.in || states.out || transits.length > 0;
      tourT = busyNow || focus ? 0 : tourT + dt;
      camGoal.copy(GATE_VIEW[0]);
      offGoal.copy(GATE_VIEW[1]);
      if (focus) {
        camGoal.set(focus.x - 2, focus.y + 1, focus.z + 2);
        offGoal.multiplyScalar(0.55);
      } else if (mover) camGoal.lerp(look.set(mover.position.x, mover.position.y + 1.2, mover.position.z), 0.55);
      else if (!still && tourT > 12) {
        // bo'sh payt: o'rtadan umumiy ko'rinish, sekin chayqalib turadi
        camGoal.copy(OVERVIEW[0]);
        offGoal.copy(OVERVIEW[1]).applyAxisAngle(Y_AXIS, Math.sin(time * 0.04) * 0.16);
      }
      if (free && (autoCam.current || performance.now() - lastTouch > 45000)) {
        free = false;
        camTarget.copy(controls.target);
        camOff.copy(camera.position).sub(controls.target);
        setFreeCam(false);
      }
      autoCam.current = false;
      if (free) controls.update();
      else {
        camTarget.lerp(camGoal, Math.min(1, dt * 1.1));
        camOff.lerp(offGoal, Math.min(1, dt * 1.1));
        camera.position.copy(camTarget).add(camOff);
        camera.position.x += Math.sin(time * 0.15) * 0.4;
        camera.lookAt(camTarget);
        controls.target.copy(camTarget); // tegilgan zahoti kamera shu nuqta atrofida aylanadi
      }
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setViewport(0, 0, w, h);
      renderer.setScissorTest(false);
      renderer.render(scene, camera);

      // Raqam kamerasi: mashina old raqamini kuzatadi (chap pastki burchak)
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
        const iw = Math.round(Math.max(150, w * 0.27));
        const ih = Math.round(iw * 0.62);
        plateCam.aspect = iw / ih;
        plateCam.updateProjectionMatrix();
        renderer.setScissorTest(true);
        renderer.setScissor(8, 8, iw, ih);
        renderer.setViewport(8, 8, iw, ih);
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
      controls.dispose();
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
    if (!release || cur?.ev.type !== 'arrive' || cur.ev.plate !== release.plate) return;
    const stall = stallFor(release.label);
    if (stall) animIn.current.add(stall.label);
    syncReq.current = true;
    current.current.in = { ...cur, fn: enterScene, t: 2.4, plan: { stall, motion: stall ? enterMotion(stall) : makeMotion([{ pts: DRIVEWAY_IN, speed: 3.6 }]) } };
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
    if (lane === 'in') animIn.current.add(event.label);
    else {
      const p = parkedRef.current;
      const label = event.label && p.has(event.label) ? event.label : [...p].find(([, v]) => v.plate === event.plate)?.[0] ?? event.label;
      if (label) pendingOut.current.add(label);
    }
    syncReq.current = true;
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
      {freeCam ? (
        <button type="button" className="gate-free" onClick={() => { autoCam.current = true; }}>Avtomatik kamera</button>
      ) : (
        <span className="gate-free hint" aria-hidden="true">Erkin ko'rish: suring, g'ildirak — yaqinlashtirish, o'ng tugma — siljitish</span>
      )}
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
