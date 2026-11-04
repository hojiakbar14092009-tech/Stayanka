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
const GATE_VIEW = [new THREE.Vector3(15, 4, -16), new THREE.Vector3(0, 13, 42)]; // to'g'ridan: darvoza, garaj va ortida Humo Arena
// 2-stoyanka: shahar x = 94 atrofida 180° buriladi — park yonidagi garaj darvoza joyiga keladi
const MIRROR = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(188, 0, 0);
// Bo'sh payt: o'rtadan umumiy ko'rinish — garaj, mall, Humo Arena, park va ikkinchi garaj bir kadrda
const OVERVIEW = [new THREE.Vector3(98, 0, 28), new THREE.Vector3(0, 125, 150)];
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
  for (const [x0, x1] of [[-50, 176.9], [180.4, 210]]) {
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
      if (z < 0 && (Math.abs(x - 0.5) < 2 || x > 5 || x < -6)) continue; // budka ro'parasi, to'xtash maydoni va binolar oldi ochiq
      if (z > 0 && (x > 128 || x < 80)) continue; // ikkinchi garaj oldi, darvoza kamerasi va Humo Arena oldi ochiq
      scene.add(buildTree(x + Math.sin(seed) * 0.6, z + Math.cos(seed) * 0.4, 0.95 + (seed % 3) * 0.12, seed++));
    }
    for (let x = -19; x <= 127; x += 2.1) if ((z > 0 && Math.abs(x - 84) > 3.5 && ((x > -6 && x < 22) || x > 79)) || (z < 0 && x > -6 && x < 6)) scene.add(buildBush(x, z > 0 ? z - 1.2 : z + 1.2, 0.8 + (seed % 2) * 0.2, seed++));
  }
  for (const x of [-5.2, 6.2]) gate.add(buildBush(x, 0, 1, seed++)); // orolchadagi gulzor
  // Ko'cha chiroqlari ikki tomonda
  for (const x of [-12, -4, 4]) buildLamp(scene, x, -ROAD_EDGE - 0.6, 1);
  for (const x of [6, 14, 26, 40, 54, 68, 100, 116]) buildLamp(scene, x, ROAD_EDGE + 0.6, -1); // old tomonda — kamerani to'smaydigan joylarda
  for (const x of [134, 152, 166, 190, 204]) buildLamp(scene, x, ROAD_EDGE + 0.6, -1, false);
  for (const x of [124, 140, 158, 176, 194]) buildLamp(scene, x, -ROAD_EDGE - 0.6, 1, false);
  // Ikkinchi garajga kirish yo'li (park yonida) va "P" belgisi
  scene.add(box(5.4, 0.17, 3.6, new THREE.MeshStandardMaterial({ map: asphaltTex([1.4, 1]), roughness: 0.92 }), { x: 177.1, y: 0.085, z: 6.6, shadow: false }));
  const p2 = textTexture('P  200', { w: 256, h: 128, bg: '#2257d6', font: 'bold 80px Arial' });
  scene.add(box(0.08, 2.8, 0.08, mat(0x8a8f96), { x: 172.6, y: 1.4, z: ROAD_EDGE + 0.6 }));
  scene.add(mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshStandardMaterial({ map: p2 }), { x: 172.6, y: 2.85, z: ROAD_EDGE + 0.65 }));
  // Uzoqdagi binolar (shahar fon) — ortda
  for (let i = 0; i < 36; i++) {
    const h = 12 + ((i * 37) % 7) * 3;
    const bw = 6 + (i % 3) * 2;
    const bld = mesh(new THREE.BoxGeometry(bw, h, 6), new THREE.MeshStandardMaterial({ map: facadeTex(0.25), roughness: 0.8 }), { x: -50 + i * 7.6, y: h / 2, z: -96 - (i % 2) * 6, shadow: false });
    scene.add(bld);
  }
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
  return { levels, drawBoard, sensorAt, marker, showZone };
}

// Ikkinchi garaj: joylarning ~60% band, mashinalar bir marta qo'yiladi; chiroqlar va tablo shunga mos
function fillGarage(gar) {
  const L = 'ABCDEFHKMNOPSTXYZ';
  const busyC = new THREE.Color(0xff3b3b);
  const freeC = new THREE.Color(0x2ee07a);
  const free = [0, 0, 0];
  for (const zone of Object.keys(ZONE_POS)) {
    for (let n = 1; n <= 40; n++) {
      const st = stallFor(zone + '-' + String(n).padStart(2, '0'));
      const [im, i] = gar.sensorAt[st.label];
      const busy = Math.random() < 0.6;
      im.setColorAt(i, busy ? busyC : freeC);
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      if (!busy) {
        free[st.level]++;
        continue;
      }
      const plate = String(10 + Math.floor(Math.random() * 80)) + L[n % 17] + (100 + Math.floor(Math.random() * 900)) + L[(n * 7) % 17] + L[(n * 3) % 17];
      const car = buildParkedCar(shapeFor(brandFor(plate, zone === 'A')), paintFor(plate));
      car.position.set(st.x, st.y, st.z);
      car.rotation.y = st.rot;
      gar.levels[st.level].group.add(car);
    }
  }
  gar.drawBoard(free);
}

// ---------- Hashamatli minoralar: pastki qavatida butiklar — vitrina, peshtoq, soyabon, gul tuvaklar; tepasi har xil shakl ----------
const BOUTIQUES = ['LUMIÈRE', 'NOIR & OR', 'ZARAFSHON', 'OLTIN IPAK', 'MAISON ARAL', 'VELOUR', 'SAMARQAND SILK', 'ATELIER 7', 'ÉCLAT', 'REGALIA',
  'AURUM', 'BELLE RIVE', 'SOIE', 'ONYX', 'MARQUIS', 'IVORY', 'CRYSTAL', 'TOSHKENT JEWELS', 'DIAMANT', 'SAFFRON'];
const SIGN_STYLES = [['#111214', '#e8c66a'], ['#0f2a22', '#f4efe3'], ['#f4efe3', '#1a1a1a'], ['#2a1430', '#f2d28a'], ['#14213d', '#ffffff']];
// [markaz x, z, burilish (old tomoni shu yo'nalishga qaraydi), balandlik ko'paytmasi]
const LUXURY_SITES = [
  ...Array.from({ length: 10 }, (_, k) => [-42 + k * 28, -66, 0, 1.25]), // shimoliy sayr xiyoboni
  [136, -18, 0, 1], [164, -18, 0, 1.1], [192, -18, 0, 0.9], // mall sharqi, katta yo'l bo'yida
  [-20, -18, 0, 0.8], [-48, -18, 0, 1], // darvozaning g'arbi
  [-20, 18, Math.PI, 0.8], [-48, 18, Math.PI, 1], [-20, 52, Math.PI, 1.1], [-48, 52, Math.PI, 0.9], [-20, 86, Math.PI, 1], [-48, 86, Math.PI, 1.2],
  [204, 18, Math.PI, 0.9], [150, 50, Math.PI, 1], [176, 50, Math.PI, 1.2], [202, 50, Math.PI, 0.9], [150, 84, Math.PI, 1.1], [176, 84, Math.PI, 0.9], [202, 84, Math.PI, 1.3],
];

function buildLuxury(scene) {
  // fasad teksturalari: 1 plitka = 2 oyna eni, 1 qavat bo'yi
  const facade = {
    glass: canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#1b2838';
      c.fillRect(0, 0, w, h);
      for (let b = 0; b < 2; b++) {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#5f7fa3');
        g.addColorStop(1, '#22344b');
        c.fillStyle = Math.random() < 0.22 ? '#f3d9a4' : g;
        c.fillRect(b * 128 + 6, 10, 116, h - 20);
      }
      c.fillStyle = '#c9a24a';
      c.fillRect(0, 0, w, 6);
      c.fillRect(126, 0, 4, h);
    }),
    stone: canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#e9dfcc';
      c.fillRect(0, 0, w, h);
      for (let b = 0; b < 2; b++) {
        c.fillStyle = '#cbbd9f';
        c.fillRect(b * 128 + 26, 30, 76, 196);
        c.fillStyle = Math.random() < 0.2 ? '#f0d49c' : '#2b3644';
        c.fillRect(b * 128 + 32, 36, 64, 184);
        c.fillStyle = '#20242a';
        c.fillRect(b * 128 + 22, 214, 84, 8); // balkon panjarasi
      }
      c.fillStyle = '#d8cbb1';
      c.fillRect(0, 0, w, 10);
    }),
    white: canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#f4f3ef';
      c.fillRect(0, 0, w, h);
      for (let b = 0; b < 4; b++) {
        c.fillStyle = Math.random() < 0.15 ? '#f6dca8' : '#7fa4c6';
        c.fillRect(b * 64 + 10, 14, 44, h - 28);
      }
    }),
  };
  const facadeMat = (kind, w, h) => {
    const t = facade[kind].clone();
    t.repeat.set(Math.max(1, Math.round(w / 7)), Math.max(1, Math.round(h / 3.6)));
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: kind === 'glass' ? 0.2 : 0.65, metalness: kind === 'glass' ? 0.55 : 0.05 });
  };
  // vitrina: iliq yorug'lik, chiroqlar, manekenlar, javonda sumkalar, eshik
  const shopTex = canvasTex(512, 320, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#4a3524');
    g.addColorStop(1, '#f1d7a6');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (const x of [90, 250, 410]) {
      const r = c.createRadialGradient(x, 40, 4, x, 120, 150);
      r.addColorStop(0, 'rgba(255,244,214,.9)');
      r.addColorStop(1, 'rgba(255,244,214,0)');
      c.fillStyle = r;
      c.fillRect(0, 0, w, h);
    }
    const dresses = ['#1a1a1a', '#8a1f2b', '#e8e2d6', '#1f3a5f'];
    [70, 150, 330].forEach((x, i) => {
      c.fillStyle = '#d9cbb5';
      c.beginPath();
      c.arc(x, 120, 13, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = dresses[i % 4];
      c.beginPath();
      c.moveTo(x - 16, 138);
      c.lineTo(x + 16, 138);
      c.lineTo(x + 34, 270);
      c.lineTo(x - 34, 270);
      c.closePath();
      c.fill();
    });
    c.fillStyle = '#6b4a2f';
    c.fillRect(395, 200, 100, 6);
    ['#b8860b', '#7a1f2b', '#1a1a1a', '#e8e2d6'].forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(400 + i * 24, 178, 18, 22);
    });
    c.fillStyle = 'rgba(20,22,26,.85)';
    c.fillRect(220, 110, 70, 210); // eshik
    c.fillStyle = '#c9a24a';
    c.fillRect(280, 210, 4, 30);
    c.fillStyle = 'rgba(255,255,255,.18)';
    c.fillRect(0, 0, w, 8);
  });
  shopTex.wrapS = shopTex.wrapT = THREE.ClampToEdgeWrapping;
  const windowMat = new THREE.MeshStandardMaterial({ map: shopTex, emissive: 0xffffff, emissiveMap: shopTex, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.2 });
  const signCache = new Map();
  const signMat = (name, [bg, fg]) => {
    const key = name + bg;
    if (!signCache.has(key)) {
      const t = canvasTex(512, 96, (c, w, h) => {
        c.fillStyle = bg;
        c.fillRect(0, 0, w, h);
        c.strokeStyle = fg;
        c.lineWidth = 3;
        c.strokeRect(6, 6, w - 12, h - 12);
        c.fillStyle = fg;
        c.font = 'bold 50px Georgia, serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(name.split('').join(' '), w / 2, h / 2 + 3);
      });
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      signCache.set(key, new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.4 }));
    }
    return signCache.get(key);
  };
  const stone = mat(0xe4dac6, { roughness: 0.6 });
  const darkStone = mat(0x2a2c31, { roughness: 0.45, metalness: 0.2 });
  const gold = mat(0xc9a24a, { metalness: 0.85, roughness: 0.28 });
  const frame = mat(0x15171a, { metalness: 0.6, roughness: 0.3 });
  const awnings = [0x14213d, 0x7a1f2b, 0x0f2a22, 0x1a1a1a].map((c) => mat(c, { roughness: 0.6 }));
  const planter = mat(0x3a3d42, { roughness: 0.5 });
  const topiary = mat(0x3f6a32, { roughness: 0.9 });
  const paving = new THREE.MeshStandardMaterial({ map: tileTex([8, 1.5]), roughness: 0.8 });
  const postGeo = new THREE.BoxGeometry(0.2, 3.7, 0.25);
  const planterGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const topiaryGeo = new THREE.SphereGeometry(0.4, 12, 8);

  LUXURY_SITES.forEach(([x, z, ry, hk], i) => {
    const r = (k) => (Math.sin(i * 91.7 + k * 13.1) + 1) / 2; // tasodifiy, lekin har ochilishda bir xil
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    const W = 20 + Math.round(r(1) * 5);
    const D = 15;
    const PH = 5.2;
    const front = D / 2;
    // podium: tosh, oltin karniz, qora sokol
    g.add(box(W, PH, D, i % 3 === 1 ? darkStone : stone, { y: PH / 2 }));
    g.add(box(W + 0.5, 0.35, D + 0.5, gold, { y: PH + 0.17 }));
    g.add(box(W + 0.1, 0.5, D + 0.1, darkStone, { y: 0.25, shadow: false }));
    g.add(box(W + 3, 0.08, 3.4, paving, { y: 0.04, z: front + 1.7, shadow: false }));
    // 3 ta butik
    const sw = (W - 1) / 3;
    for (let k = 0; k <= 3; k++) g.add(mesh(postGeo, frame, { x: -W / 2 + 0.5 + sw * k, y: 1.85, z: front + 0.1, shadow: false }));
    g.add(box(W - 0.6, 0.25, 0.3, frame, { y: 3.75, z: front + 0.1, shadow: false }));
    for (let k = 0; k < 3; k++) {
      const sx = -W / 2 + 0.5 + sw * (k + 0.5);
      g.add(mesh(new THREE.PlaneGeometry(sw - 0.3, 3.4), windowMat, { x: sx, y: 1.95, z: front + 0.03, shadow: false }));
      g.add(mesh(new THREE.PlaneGeometry(sw - 0.9, 0.78), signMat(BOUTIQUES[(i * 3 + k) % BOUTIQUES.length], SIGN_STYLES[(i + k) % SIGN_STYLES.length]), { x: sx, y: 4.45, z: front + 0.05, shadow: false }));
      const aw = box(sw - 0.5, 0.06, 1.4, awnings[(i + k) % 4], { x: sx, y: 3.65, z: front + 0.75, shadow: false });
      aw.rotation.x = 0.3;
      g.add(aw);
    }
    for (let k = 0; k <= 3; k++) {
      const px = -W / 2 + 0.5 + sw * k;
      g.add(mesh(planterGeo, planter, { x: px, y: 0.3, z: front + 0.9, shadow: false }), mesh(topiaryGeo, topiary, { x: px, y: 0.98, z: front + 0.9, shadow: false }));
    }
    // minora
    const H = Math.round((26 + r(2) * 40) * hk);
    const tw = W * 0.74;
    const td = D * 0.74;
    const y0 = PH + 0.35;
    const type = i % 4;
    if (type === 0) {
      g.add(box(tw, H, td, facadeMat('glass', tw, H), { y: y0 + H / 2 }));
      g.add(box(tw + 0.4, 1.3, td + 0.4, gold, { y: y0 + H + 0.65 }));
      g.add(mesh(new THREE.CylinderGeometry(0.08, 0.3, 9, 8), gold, { y: y0 + H + 5.8 }));
    } else if (type === 1) {
      const R = td * 0.62;
      g.add(mesh(new THREE.CylinderGeometry(R, R, H, 40), facadeMat('white', 2 * Math.PI * R, H), { y: y0 + H / 2 }));
      for (let yy = 12; yy < H; yy += 12) g.add(mesh(new THREE.CylinderGeometry(R + 0.18, R + 0.18, 0.35, 40), gold, { y: y0 + yy, shadow: false }));
      const cap = mesh(new THREE.SphereGeometry(R, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9fc3e0, { metalness: 0.7, roughness: 0.15 }), { y: y0 + H });
      cap.scale.y = 0.45;
      g.add(cap);
    } else if (type === 2) {
      let yy = y0;
      [[1, 0.5], [0.8, 0.3], [0.6, 0.2]].forEach(([k, f]) => {
        const hh = H * f;
        g.add(box(tw * k, hh, td * k, facadeMat('stone', tw * k, hh), { y: yy + hh / 2 }));
        yy += hh;
        g.add(box(tw * k + 0.5, 0.4, td * k + 0.5, gold, { y: yy + 0.2, shadow: false }));
      });
      const roof = mesh(new THREE.ConeGeometry(tw * 0.42, 4, 4), mat(0x3f5a6b, { metalness: 0.6, roughness: 0.35 }), { y: yy + 2.4 });
      roof.rotation.y = Math.PI / 4;
      g.add(roof);
    } else {
      const floors = Math.round(H / 3.6);
      const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(tw * 0.92, 3.5, td * 0.92), facadeMat('glass', tw, 3.6), floors);
      const m4 = new THREE.Matrix4();
      for (let f = 0; f < floors; f++) slabs.setMatrixAt(f, m4.makeRotationY((f * 3.2 * Math.PI) / 180).setPosition(0, y0 + 1.75 + f * 3.6, 0));
      slabs.castShadow = true;
      g.add(slabs);
      g.add(mesh(new THREE.TorusGeometry(td * 0.5, 0.12, 8, 48), gold, { y: y0 + floors * 3.6 + 0.4, shadow: false }));
      g.children.at(-1).rotation.x = Math.PI / 2;
    }
  });

  // shimoliy sayr xiyoboni: plitka, daraxtlar va chiroqlar butiklar qatori oldida
  scene.add(mesh(new THREE.BoxGeometry(272, 0.05, 6), new THREE.MeshStandardMaterial({ map: tileTex([90, 2]), roughness: 0.85 }), { x: 84, y: 0.03, z: -54.5, shadow: false }));
  let seed = 500;
  for (let x = -50; x <= 214; x += 14) {
    scene.add(buildTree(x, -51, 0.9, seed++));
    buildLamp(scene, x + 7, -51.2, 1, false);
  }
}

// ---------- Savdo markazi: egri shisha fasad, to'lqinli tom-soyabon, burama minora ----------
// Yozuv: "Tashkent City Mall" — podium tepasida, maydonga qaragan
function buildMall(scene) {
  const g = new THREE.Group();
  g.position.set(87, 0, -22); // g'arbiy devori garaj rampasiga tegib turadi (x 57)
  g.scale.set(2.3, 1.75, 2.3); // balandligi kamroq: 2-qavat garaj tomi bilan bir sathda — ko'prik to'g'ri kiradi
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

  // Garaj bilan savdo markazi orasidagi maydon: plitka, daraxtlar, bayroqlar
  scene.add(mesh(new THREE.BoxGeometry(62, 0.06, 7.4), new THREE.MeshStandardMaterial({ map: tileTex([24, 3]), roughness: 0.85 }), { x: 87, y: 0.03, z: -10.1, shadow: false }));
  for (const [x, z] of [[119, -10], [119.5, -16.5], [121, -23]]) scene.add(buildTree(x, z, 1.2, x));
  const flagCloth = [0x1eb5e0, 0xf4f3ef, 0x1fa35a];
  for (let i = 0; i < 3; i++) {
    const fx = 100 + i * 1.2;
    scene.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 8), mat(0xd9dde3, { metalness: 1, roughness: 0.2 }), { x: fx, y: 2, z: -11.8 }));
    const cloth = mesh(new THREE.PlaneGeometry(0.9, 0.55, 8, 4), mat(flagCloth[i], { side: THREE.DoubleSide, roughness: 0.8 }), { x: fx + 0.45, y: 3.65, z: -11.8 });
    scene.add(cloth);
    g.userData.flags = [...(g.userData.flags || []), cloth];
  }
  // Shisha piyodalar ko'prigi: garaj tomidan savdo markazining yon tomoniga (2-qavat)
  const bridge = new THREE.Group();
  bridge.position.set(52.75, 2 * FLOOR_H, -24.9);
  bridge.rotation.y = Math.PI / 2;
  const bridgeGlass = new THREE.MeshPhysicalMaterial({ color: 0xbfd6ea, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
  bridge.add(box(3, 0.25, 8.3, slab, { y: -0.12 }), box(3.3, 0.14, 8.5, slab, { y: 2.66 }));
  bridge.add(mesh(new THREE.BoxGeometry(3, 2.55, 8.3), bridgeGlass, { y: 1.3, shadow: false }));
  for (const x of [-1.5, 1.5]) bridge.add(box(0.05, 0.05, 8.3, mat(0xf2c230, { emissive: 0xf2c230, emissiveIntensity: 1.3 }), { x, y: 0.03, shadow: false }));
  for (const z of [-2.2, 2.2]) bridge.add(mesh(new THREE.CylinderGeometry(0.22, 0.28, 2 * FLOOR_H, 14), slab, { y: -FLOOR_H, z }));
  scene.add(bridge);

  // Yopiq piyodalar yo'lagi: garaj oldidan savdo markazi eshigigacha — shisha soyabon va yo'nalish belgilari
  const canopyGlass = new THREE.MeshPhysicalMaterial({ color: 0xcfe3f2, roughness: 0.08, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
  const post = mat(0xd9dde3, { metalness: 0.9, roughness: 0.25 });
  scene.add(mesh(new THREE.BoxGeometry(32.5, 0.08, 2.9), canopyGlass, { x: 66.2, y: 3.1, z: -7.1, shadow: false }));
  for (const z of [-5.75, -8.45]) scene.add(box(32.5, 0.14, 0.12, post, { x: 66.2, y: 3.05, z }));
  for (let x = 50; x <= 82; x += 4) for (const z of [-5.75, -8.45]) scene.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.1, 8), post, { x, y: 1.55, z }));
  const toMall = textTexture('Tashkent City Mall  →', { w: 1024, h: 128, bg: '#163a2b', fg: '#f2c230', font: 'bold 70px Georgia' });
  for (const x of [52, 68]) scene.add(mesh(new THREE.PlaneGeometry(4.2, 0.52), new THREE.MeshStandardMaterial({ map: toMall, emissive: 0xffffff, emissiveMap: toMall, emissiveIntensity: 0.5 }), { x, y: 2.72, z: -5.68, shadow: false }));
  return g;
}

// ---------- Humo Arena: elliptik muz saroyi — pastda shisha qavat, "Humo qushi patlari" kabi egilgan oq qanotlar, gumbazsimon tom, ko'k chiroq halqalari ----------
function buildArena(scene) {
  const AX = 50;
  const AZ = 32;
  const RX = 25;
  const RZ = 17;
  const g = new THREE.Group();
  g.position.set(AX, 0, AZ);
  g.rotation.y = Math.PI; // kirish yo'lga (shimolga) qaragan
  scene.add(g);
  const white = mat(0xf4f3ef, { metalness: 0.2, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x6f9cc8, metalness: 0.5, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.9 });
  const blue = mat(0x2f8cff, { emissive: 0x2f8cff, emissiveIntensity: 1.6 });
  const oval = (r, h, m, y, open = false) => {
    const c = mesh(new THREE.CylinderGeometry(1, 1, h, 96, 1, open), m, { y });
    c.scale.set(r * RX, 1, r * RZ);
    return c;
  };
  g.add(oval(1.1, 1.2, mat(0xd9d4c8, { roughness: 0.8 }), 0.6)); // stilobat
  g.add(oval(0.95, 6, glass, 4.2, true)); // pastki shisha qavat (foye)
  g.add(oval(1.0, 0.5, white, 7.45));
  g.add(oval(1.003, 0.16, blue, 7.1, true));
  g.add(oval(0.93, 9.6, mat(0x1d3550, { roughness: 0.4 }), 12.4)); // ichki baraban
  // qanotlar: ellips bo'ylab 72 ta, har biri tashqariga qaragan va yon tomonga egilgan
  const fins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 11.5, 2.4), white, 72);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    e.set(-0.12, Math.atan2(Math.cos(a) / RX, Math.sin(a) / RZ), 0.42);
    q.setFromEuler(e);
    m4.compose(new THREE.Vector3(Math.cos(a) * RX, 13.2, Math.sin(a) * RZ), q, one);
    fins.setMatrixAt(i, m4);
  }
  fins.castShadow = true;
  g.add(fins);
  // gumbazsimon oq tom va uning chetidagi ko'k halqa
  const dome = mesh(new THREE.SphereGeometry(1, 96, 18, 0, Math.PI * 2, 0, Math.PI / 2), white, { y: 18.6 });
  dome.scale.set(RX * 1.08, 4.2, RZ * 1.08);
  g.add(dome);
  g.add(oval(1.085, 0.5, white, 18.6));
  g.add(oval(1.09, 0.22, blue, 18.3, true));
  // kirish: soyabon, shisha eshiklar, zinapoyalar va "HUMO ARENA" yozuvi
  g.add(box(18, 0.45, 5.5, white, { y: 6.2, z: RZ + 2.2 }));
  for (const x of [-8, 8]) g.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 14), white, { x, y: 3, z: RZ + 4.4 }));
  g.add(box(15, 4.2, 0.2, mat(0x16202b, { metalness: 0.6, roughness: 0.1 }), { y: 3.3, z: RZ * 0.95 + 0.7 }));
  for (let k = 0; k < 3; k++) g.add(box(22 - k * 1.2, 0.2, 1.1, mat(0xe3ded2), { y: 0.1 + k * 0.2, z: RZ + 6.6 - k * 1.1 }));
  const signTex = textTexture('HUMO ARENA', { w: 1024, h: 160, fg: '#1f78ff', font: 'bold 124px Arial' });
  signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping;
  g.add(mesh(new THREE.PlaneGeometry(24, 3.75), new THREE.MeshStandardMaterial({ map: signTex, transparent: true, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.9 }), { y: 20.4, z: RZ + 1.4, shadow: false }));
  // oldidagi maydon (yo'lgacha), daraxtlar
  scene.add(mesh(new THREE.BoxGeometry(56, 0.06, 6.4), new THREE.MeshStandardMaterial({ map: tileTex([22, 3]), roughness: 0.85 }), { x: AX, y: 0.03, z: 10.5, shadow: false }));
  let seed = 300;
  for (const x of [AX - 33, AX - 37]) for (const z of [AZ - 6, AZ + 6]) scene.add(buildTree(x, z, 1.1, seed++));
  return (time) => {
    blue.emissiveIntensity = 1.3 + Math.sin(time * 1.4) * 0.35;
  };
}

// ---------- Tashkent City Park: savdo markazi ro'parasida — charxpalak, karusel, amerikan tepaligi, tushish minorasi, favvora ----------
const PARK_DZ = 42; // park arena ortida: yo'ldan park darvozasigacha ochiq xiyobon
function buildPark(city) {
  const scene = new THREE.Group();
  scene.position.z = PARK_DZ;
  city.add(scene);
  const PX = 84;
  // yo'l → park darvozasi: arena yonidan o'tadigan xiyobon, ikki chetida butalar, yo'lda "zebra"
  city.add(mesh(new THREE.BoxGeometry(4, 0.05, PARK_DZ + 2.4), new THREE.MeshStandardMaterial({ map: tileTex([2, 22]), roughness: 0.85 }), { x: PX, y: 0.03, z: 7.35 + (PARK_DZ + 2.4) / 2, shadow: false }));
  for (let z = 10; z < PARK_DZ + 8; z += 2.3) for (const dx of [-3, 3]) city.add(buildBush(PX + dx, z, 0.75, z * 7 + dx));
  for (let z = -4.3; z <= 4.3; z += 0.95) city.add(box(3.6, 0.012, 0.48, mat(0xeceae4, { roughness: 0.8 }), { x: PX, y: 0.024, z, shadow: false }));
  // xiyobonning sharqi (yo'l bilan park orasi) — siyrak daraxtzor
  for (let x = 92; x <= 126; x += 6.5) for (let z = 14; z <= PARK_DZ + 4; z += 7) city.add(buildTree(x + Math.sin(x * z) * 1.5, z + Math.cos(x + z) * 1.5, 0.9 + ((x + z) % 3) * 0.12, x * z));
  const white = mat(0xf4f3ef, { metalness: 0.4, roughness: 0.35 });
  const steel = mat(0xc9ced6, { metalness: 0.8, roughness: 0.3 });
  const glowMat = (c, k = 1.6) => mat(c, { emissive: c, emissiveIntensity: k });
  const tiles = (rx, ry) => new THREE.MeshStandardMaterial({ map: tileTex([rx, ry]), roughness: 0.85 });
  // xiyobonlar: kirishdan markazga va aylana maydon
  scene.add(mesh(new THREE.BoxGeometry(4, 0.05, 34), tiles(2, 17), { x: PX, y: 0.03, z: 26, shadow: false }));
  scene.add(mesh(new THREE.BoxGeometry(44, 0.05, 3.2), tiles(22, 1.6), { x: PX, y: 0.031, z: 22, shadow: false }));
  const plaza = mesh(new THREE.RingGeometry(5.6, 8.4, 48), tiles(8, 2), { x: 72, y: 0.035, z: 34, shadow: false });
  plaza.rotation.x = -Math.PI / 2;
  scene.add(plaza);

  // Kirish arkasi: "Tashkent City Park"
  const archTex = canvasTex(1024, 160, (c, w, h) => {
    c.fillStyle = '#163a2b';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2c230';
    c.font = 'bold 92px Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('Tashkent City Park', w / 2, h / 2 + 4);
  });
  archTex.wrapS = archTex.wrapT = THREE.ClampToEdgeWrapping;
  for (const dx of [-3.4, 3.4]) scene.add(mesh(new THREE.CylinderGeometry(0.28, 0.34, 5.2, 16), white, { x: PX + dx, y: 2.6, z: 9.8 }));
  scene.add(box(7.6, 1.1, 0.3, mat(0x163a2b), { x: PX, y: 5.4, z: 9.8 }));
  scene.add(mesh(new THREE.PlaneGeometry(7.2, 1.0), new THREE.MeshStandardMaterial({ map: archTex, emissive: 0xffffff, emissiveMap: archTex, emissiveIntensity: 0.6 }), { x: PX, y: 5.4, z: 9.97, shadow: false }));
  const archBack = mesh(new THREE.PlaneGeometry(7.2, 1.0), new THREE.MeshStandardMaterial({ map: archTex, emissive: 0xffffff, emissiveMap: archTex, emissiveIntensity: 0.6 }), { x: PX, y: 5.4, z: 9.63, shadow: false });
  archBack.rotation.y = Math.PI;
  scene.add(archBack);

  // Charxpalak: 16 kabina, LED gardish, A-shaklidagi oyoqlar; kabinalar doim tik turadi
  const wheel = new THREE.Group();
  wheel.position.set(PX + 9, 15.5, 30);
  scene.add(wheel);
  const R = 12;
  for (const z of [-0.8, 0.8]) {
    wheel.add(mesh(new THREE.TorusGeometry(R, 0.16, 8, 96), white, { z }));
    wheel.add(mesh(new THREE.TorusGeometry(R * 0.55, 0.1, 8, 64), white, { z }));
  }
  const led = mesh(new THREE.TorusGeometry(R + 0.25, 0.07, 6, 96), glowMat(0xff4fd8, 2), { shadow: false });
  wheel.add(led);
  const hub = mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 20), steel, {});
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const cabins = [];
  const cabinColors = [0xe24b4b, 0xf2c230, 0x2e8be0, 0x2fbf71];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (const z of [-0.8, 0.8]) {
      const sp = mesh(new THREE.CylinderGeometry(0.06, 0.06, R, 6), white, { x: Math.cos(a) * R / 2, y: Math.sin(a) * R / 2, z });
      sp.rotation.z = a - Math.PI / 2;
      wheel.add(sp);
    }
    const cab = new THREE.Group();
    cab.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    const body = mesh(new THREE.BoxGeometry(1.3, 1.2, 1.1), mat(cabinColors[i % 4], { roughness: 0.4 }), { y: -1.0 });
    cab.add(body, box(1.45, 0.12, 1.25, white, { y: -0.36 }), mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), steel, { y: -0.2 }));
    cab.add(box(1.32, 0.45, 1.12, new THREE.MeshPhysicalMaterial({ color: 0xbfd6ea, roughness: 0.05, transparent: true, opacity: 0.5 }), { y: -0.85 }));
    wheel.add(cab);
    cabins.push(cab);
  }
  for (const [dx, dz] of [[-6.5, -2.2], [6.5, -2.2], [-6.5, 2.2], [6.5, 2.2]]) {
    const len = Math.hypot(dx, 15.5, dz * 0.6);
    const leg = mesh(new THREE.CylinderGeometry(0.22, 0.32, len, 10), steel, { x: PX + 9 + dx / 2, y: 15.5 / 2, z: 30 + dz * 0.7 });
    leg.lookAt(PX + 9, 15.5, 30 + dz * 0.4);
    leg.rotateX(Math.PI / 2);
    scene.add(leg);
  }
  scene.add(box(5, 1.2, 3, white, { x: PX + 9, y: 0.6, z: 30 })); // chipta kassasi va platforma

  // Karusel: aylanadigan tom, 8 ta ot ustunlarda chiqib-tushadi
  const carousel = new THREE.Group();
  carousel.position.set(70, 0, 20);
  scene.add(carousel);
  scene.add(mesh(new THREE.CylinderGeometry(4.3, 4.5, 0.4, 40), mat(0xe9e2d0), { x: 70, y: 0.2, z: 20 }));
  const spin = new THREE.Group();
  carousel.add(spin);
  spin.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 4.2, 16), mat(0xd4a93a, { metalness: 0.8, roughness: 0.3 }), { y: 2.3 }));
  spin.add(mesh(new THREE.ConeGeometry(4.6, 1.8, 16), mat(0xd94a6a, { roughness: 0.5 }), { y: 5.3 }));
  const fringe = mesh(new THREE.TorusGeometry(4.5, 0.08, 6, 64), glowMat(0xffd76a, 1.8), { y: 4.4, shadow: false });
  fringe.rotation.x = Math.PI / 2;
  spin.add(fringe);
  const horses = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    spin.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 4, 6), steel, { x: Math.cos(a) * 3.2, y: 2.4, z: Math.sin(a) * 3.2 }));
    const h = new THREE.Group();
    h.position.set(Math.cos(a) * 3.2, 1.4, Math.sin(a) * 3.2);
    h.rotation.y = -a;
    const coat = mat([0xf4f3ef, 0x6b4a2f, 0x2b2b2e, 0xd9b27c][i % 4], { roughness: 0.5 });
    h.add(box(0.3, 0.42, 1.1, coat), box(0.24, 0.5, 0.3, coat, { y: 0.35, z: 0.5 }));
    for (const [x, z] of [[-0.1, -0.4], [0.1, -0.4], [-0.1, 0.4], [0.1, 0.4]]) h.add(box(0.07, 0.5, 0.07, coat, { x, y: -0.42, z }));
    spin.add(h);
    horses.push(h);
  }

  // Tushish minorasi: chiziqli ustun, o'rindiq-halqa yuqoriga ko'tarilib, keskin tushadi
  const TX = 101;
  const TZ = 18;
  for (let i = 0; i < 12; i++) scene.add(mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 20), i % 2 ? white : mat(0xe24b4b, { roughness: 0.5 }), { x: TX, y: 1.1 + i * 2.2, z: TZ }));
  scene.add(mesh(new THREE.SphereGeometry(1.1, 20, 12), glowMat(0xf2c230, 1.5), { x: TX, y: 27, z: TZ }));
  const seat = new THREE.Group();
  seat.position.set(TX, 3, TZ);
  seat.add(mesh(new THREE.TorusGeometry(1.7, 0.35, 10, 32), mat(0x2e8be0, { roughness: 0.4 })));
  seat.children[0].rotation.x = Math.PI / 2;
  seat.add(mesh(new THREE.TorusGeometry(2.1, 0.06, 6, 40), glowMat(0x5af0ff, 2), { shadow: false }));
  seat.children[1].rotation.x = Math.PI / 2;
  scene.add(seat);

  // Amerikan tepaligi: yopiq egri yo'l, qizil relslar, tayanch ustunlar va yugurayotgan vagonchalar
  const track = new THREE.CatmullRomCurve3([
    [90, 1.6, 33], [95, 7, 40], [102, 13, 39], [108, 5, 33], [106, 9, 26], [99, 2.2, 26.5], [94, 6.5, 29], [89, 3, 28],
  ].map(([x, y, z]) => new THREE.Vector3(x + 13, y, z)), true, 'centripetal');
  const rail = mat(0xd63a3a, { metalness: 0.5, roughness: 0.35 });
  scene.add(mesh(new THREE.TubeGeometry(track, 400, 0.16, 8, true), rail, {}));
  const p = new THREE.Vector3();
  for (let i = 0; i < 40; i++) {
    track.getPointAt(i / 40, p);
    scene.add(mesh(new THREE.CylinderGeometry(0.09, 0.12, p.y, 6), steel, { x: p.x, y: p.y / 2, z: p.z }));
  }
  const train = [];
  for (let i = 0; i < 4; i++) {
    const car = new THREE.Group();
    car.add(box(0.9, 0.45, 1.3, mat(i === 0 ? 0xf2c230 : 0x2e8be0, { roughness: 0.4 }), { y: 0.35 }));
    car.add(box(0.7, 0.1, 0.4, mat(0x15171a), { y: 0.62, z: -0.2 }));
    scene.add(car);
    train.push(car);
  }

  // Favvora: tosh hovuz, suv yuzasi, raqsga tushayotgan suv oqimlari
  const FX = 72;
  const FZ = 34;
  scene.add(mesh(new THREE.CylinderGeometry(5.6, 5.8, 0.5, 48), mat(0xd7d1c3, { roughness: 0.7 }), { x: FX, y: 0.25, z: FZ }));
  scene.add(mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.06, 48), new THREE.MeshPhysicalMaterial({ color: 0x3f8fc9, roughness: 0.05, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.85 }), { x: FX, y: 0.48, z: FZ, shadow: false }));
  const waterMat = new THREE.MeshStandardMaterial({ color: 0xdff3ff, emissive: 0x9fd8ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.65 });
  const jets = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i === 8 ? 0 : 3.4;
    const j = mesh(new THREE.CylinderGeometry(0.05, 0.14, 1, 8), waterMat, { x: FX + Math.cos(a) * r, y: 0.5, z: FZ + Math.sin(a) * r, shadow: false });
    j.geometry.translate(0, 0.5, 0);
    scene.add(j);
    jets.push(j);
  }

  // ---------- Kengaytirilgan janubiy qism: zanjirli arg'imchoq, choynak karusel, urilma mashinalar, ko'l va oqqush qayiqlar, bolalar poyezdi, qaroqchi kemasi ----------
  scene.add(mesh(new THREE.BoxGeometry(4, 0.05, 30), tiles(2, 15), { x: PX, y: 0.03, z: 58, shadow: false })); // markaziy xiyobon davomi
  scene.add(mesh(new THREE.BoxGeometry(70, 0.05, 3.2), tiles(35, 1.6), { x: 92, y: 0.031, z: 45, shadow: false })); // ko'ndalang xiyobon
  scene.add(mesh(new THREE.BoxGeometry(3.2, 0.05, 32), tiles(1.6, 16), { x: 58, y: 0.031, z: 30, shadow: false })); // g'arbiy yo'lka

  // Zanjirli arg'imchoq: aylanadigan toj, 12 o'rindiq tezlikka qarab tashqariga uchadi
  const SW = { x: 64, z: 57 };
  scene.add(mesh(new THREE.CylinderGeometry(3, 3.2, 0.3, 32), mat(0xe9e2d0), { x: SW.x, y: 0.15, z: SW.z }));
  scene.add(mesh(new THREE.CylinderGeometry(0.45, 0.6, 9, 16), mat(0x2e8be0, { metalness: 0.5, roughness: 0.4 }), { x: SW.x, y: 4.5, z: SW.z }));
  const swingTop = new THREE.Group();
  swingTop.position.set(SW.x, 9, SW.z);
  scene.add(swingTop);
  swingTop.add(mesh(new THREE.ConeGeometry(3.4, 1.4, 24), mat(0xf2c230, { roughness: 0.5 }), { y: 0.7 }));
  const swingRing = mesh(new THREE.TorusGeometry(3.3, 0.07, 6, 48), glowMat(0x5af0ff, 1.8), { shadow: false });
  swingRing.rotation.x = Math.PI / 2;
  swingTop.add(swingRing);
  const swings = [];
  for (let i = 0; i < 12; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 12) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.x = 3;
    const seatMat = mat(cabinColors[i % 4], { roughness: 0.4 });
    pivot.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4), steel, { y: -2, shadow: false }));
    pivot.add(box(0.5, 0.08, 0.5, seatMat, { y: -4 }), box(0.5, 0.45, 0.06, seatMat, { y: -3.8, z: -0.22 }));
    arm.add(pivot);
    swingTop.add(arm);
    swings.push(pivot);
  }

  // Choynak karusel: aylanuvchi disk ustida o'zi ham aylanadigan 5 ta piyola
  scene.add(mesh(new THREE.CylinderGeometry(4.6, 4.8, 0.3, 40), mat(0xd94a6a, { roughness: 0.5 }), { x: 77, y: 0.15, z: 54 }));
  const teacups = new THREE.Group();
  teacups.position.set(77, 0.3, 54);
  scene.add(teacups);
  const cups = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const cup = new THREE.Group();
    cup.position.set(Math.cos(a) * 2.8, 0, Math.sin(a) * 2.8);
    cup.add(mesh(new THREE.CylinderGeometry(0.95, 0.6, 0.9, 20, 1, true), mat(cabinColors[(i + 1) % 4], { roughness: 0.35, side: THREE.DoubleSide }), { y: 0.55 }));
    cup.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 20), white, { y: 0.12 }));
    const lip = mesh(new THREE.TorusGeometry(0.97, 0.06, 6, 24), white, { y: 1.0 });
    lip.rotation.x = Math.PI / 2;
    cup.add(lip);
    teacups.add(cup);
    cups.push(cup);
  }

  // Urilma mashinalar: tomli maydoncha, 6 ta mashina erkin aylanib yuradi
  const BC = { x: 73, z: 68 };
  scene.add(box(13, 0.2, 7.5, mat(0x3a3f47, { metalness: 0.4, roughness: 0.5 }), { x: BC.x, y: 0.1, z: BC.z }));
  for (const [dx, dz] of [[-6.3, -3.6], [6.3, -3.6], [-6.3, 3.6], [6.3, 3.6]]) scene.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 8), steel, { x: BC.x + dx, y: 2, z: BC.z + dz }));
  scene.add(box(13.4, 0.25, 7.9, mat(0x163a2b), { x: BC.x, y: 4.1, z: BC.z }));
  scene.add(box(13.4, 0.08, 0.1, glowMat(0xff4fd8, 2), { x: BC.x, y: 3.95, z: BC.z + 3.95, shadow: false }));
  const bumpers = [];
  const rubber = mat(0x15171a);
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Group();
    c.add(box(1.1, 0.4, 1.5, mat(cabinColors[i % 4], { roughness: 0.3, metalness: 0.2 }), { y: 0.45 }));
    const bumper = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.18, 18), rubber, { y: 0.3 });
    bumper.scale.set(0.8, 1, 1.05);
    c.add(bumper, mesh(new THREE.CylinderGeometry(0.02, 0.02, 3.4, 4), steel, { y: 2.2, z: -0.5, shadow: false }));
    scene.add(c);
    bumpers.push({ c, p: i * 1.7, w: 0.35 + (i % 3) * 0.08 });
  }

  // Ko'l va oqqush qayiqlar
  const LK = { x: 101, z: 59, rx: 11, rz: 7 };
  const rim = mesh(new THREE.CylinderGeometry(1, 1, 0.3, 64), mat(0xcfc8b8, { roughness: 0.8 }), { x: LK.x, y: 0.15, z: LK.z });
  rim.scale.set(LK.rx + 0.8, 1, LK.rz + 0.8);
  scene.add(rim);
  const lake = mesh(new THREE.CylinderGeometry(1, 1, 0.08, 64), new THREE.MeshPhysicalMaterial({ color: 0x3f8fc9, roughness: 0.05, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.9 }), { x: LK.x, y: 0.31, z: LK.z, shadow: false });
  lake.scale.set(LK.rx, 1, LK.rz);
  scene.add(lake);
  const plume = mat(0xffffff, { roughness: 0.5 });
  const swans = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group();
    const body = mesh(new THREE.SphereGeometry(0.7, 16, 10), plume, { y: 0.35 });
    body.scale.set(0.8, 0.55, 1.3);
    const beak = mesh(new THREE.ConeGeometry(0.06, 0.25, 6), mat(0xf28a1e), { y: 1.42, z: 0.92 });
    beak.rotation.x = Math.PI / 2;
    b.add(body, mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.0, 8), plume, { y: 0.95, z: 0.65 }), mesh(new THREE.SphereGeometry(0.17, 10, 8), plume, { y: 1.45, z: 0.72 }), beak);
    scene.add(b);
    swans.push({ b, ph: i * 1.6, w: 0.09 + i * 0.015, r: 0.45 + (i % 2) * 0.2 });
  }

  // Bolalar poyezdi: ko'l atrofidagi relsda lokomotiv va 3 vagon
  const trainPath = new THREE.CatmullRomCurve3(Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    return new THREE.Vector3(LK.x + Math.cos(a) * 14.5, 0.12, LK.z + Math.sin(a) * 10 + Math.sin(a * 3) * 0.6);
  }), true);
  scene.add(mesh(new THREE.TubeGeometry(trainPath, 200, 0.07, 4, true), mat(0x6b4a2f), { shadow: false }));
  const sleeperMat = mat(0x5a4636);
  for (let i = 0; i < 90; i++) {
    trainPath.getPointAt(i / 90, p);
    const tn = trainPath.getTangentAt(i / 90);
    const sl = box(0.9, 0.06, 0.2, sleeperMat, { x: p.x, y: 0.05, z: p.z, shadow: false });
    sl.rotation.y = Math.atan2(tn.x, tn.z);
    scene.add(sl);
  }
  const kidTrain = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Group();
    c.add(box(1, 0.7, 1.8, mat(i === 0 ? 0xd63a3a : cabinColors[i % 4], { roughness: 0.4 }), { y: 0.55 }));
    c.add(i === 0 ? mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.6, 10), rubber, { y: 1.2, z: 0.5 }) : box(1.05, 0.06, 1.85, white, { y: 1.5 }));
    for (const z of [-0.6, 0.6]) for (const x of [-0.5, 0.5]) {
      const wh = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), rubber, { x, y: 0.2, z });
      wh.rotation.z = Math.PI / 2;
      c.add(wh);
    }
    scene.add(c);
    kidTrain.push(c);
  }

  // Qaroqchi kemasi: A-shaklidagi ramka, kema bo'yi bo'ylab tebranadi
  const SH = { x: 122, z: 56 };
  for (const dx of [-2.6, 2.6]) {
    for (const dz of [-4.5, 4.5]) {
      const leg = mesh(new THREE.CylinderGeometry(0.18, 0.25, Math.hypot(9, dz), 10), steel, { x: SH.x + dx, y: 4.5, z: SH.z + dz / 2 });
      leg.rotation.x = -Math.atan2(dz, 9);
      scene.add(leg);
    }
  }
  const axle = mesh(new THREE.CylinderGeometry(0.2, 0.2, 5.6, 12), steel, { x: SH.x, y: 9, z: SH.z });
  axle.rotation.z = Math.PI / 2;
  scene.add(axle);
  const shipPivot = new THREE.Group();
  shipPivot.position.set(SH.x, 9, SH.z);
  scene.add(shipPivot);
  const wood = mat(0x7a4a2a, { roughness: 0.7 });
  shipPivot.add(box(2.6, 1.3, 7.5, wood, { y: -6.4 }), box(2.7, 0.18, 7.6, mat(0xf2c230), { y: -5.7 }));
  for (const z of [-3.6, 3.6]) {
    const end = box(2.4, 1.2, 1.6, wood, { y: -5.6, z });
    end.rotation.x = z > 0 ? -0.5 : 0.5;
    shipPivot.add(end);
  }
  shipPivot.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.6, 8), wood, { y: -3.9 }));
  shipPivot.add(mesh(new THREE.PlaneGeometry(2.6, 2.0), mat(0xf4f3ef, { side: THREE.DoubleSide }), { y: -3.6 }));
  for (const z of [-2.2, 2.2]) {
    const arm = mesh(new THREE.CylinderGeometry(0.1, 0.1, Math.hypot(6.2, z), 8), steel, { y: -3.1, z: z / 2 });
    arm.rotation.x = -Math.atan2(z, 6.2);
    shipPivot.add(arm);
  }

  // Sayr qiluvchilar: xiyobonlar va ko'l bo'yida yurishadi
  const lakeLoop = Array.from({ length: 16 }, (_, i) => [LK.x + Math.cos((i / 16) * Math.PI * 2) * 12.4, LK.z + Math.sin((i / 16) * Math.PI * 2) * 8.4]);
  const strollPaths = [
    [[83.2, 12], [83.2, 72], [84.8, 72], [84.8, 12]],
    [[84.8, 40], [84.8, 12], [83.2, 12], [83.2, 40]],
    [[58, 44.4], [126, 44.4], [126, 45.6], [58, 45.6]],
    [[110, 45.6], [58, 45.6], [58, 44.4], [110, 44.4]],
    [[60, 21.4], [106, 21.4], [106, 22.6], [60, 22.6]],
    [[57.5, 16], [57.5, 44], [58.6, 44], [58.6, 16]],
    lakeLoop,
    [...lakeLoop].reverse(),
  ];
  const strollers = strollPaths.map((pts, i) => {
    const pp = buildGuard(CIVILIANS[i % CIVILIANS.length]);
    pp.scale.setScalar(0.95);
    scene.add(pp);
    const loop = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0.05, z)), true, 'centripetal');
    return { pp, loop, len: loop.getLength(), s: (i * 0.37) % 1, speed: 0.9 + (i % 3) * 0.15 };
  });

  // Daraxtlar: atraksion va yo'lkalardan bo'sh joylarga, tartibsiz (tabiiy) joylashuv
  const taken = [[81.5, 86.5, 9, 74], [60, 108, 20, 24], [56, 127, 43, 47], [56.4, 59.6, 14, 46], [64, 76, 14, 26], [63, 81, 25, 43], [79, 107, 26, 34],
    [97, 105, 14, 22], [100, 124, 23, 43], [56, 72, 49, 65], [72, 82, 49, 59], [65, 81, 63, 73], [85, 117, 47, 71], [117, 127, 46, 66]];
  let seed = 120;
  for (let x = 58; x <= 127; x += 4.6) {
    for (let z = 13; z <= 72; z += 4.6) {
      const jx = x + Math.sin(seed * 12.9898) * 1.6;
      const jz = z + Math.cos(seed * 78.233) * 1.6;
      seed++;
      if (taken.some(([x0, x1, z0, z1]) => jx > x0 - 1.5 && jx < x1 + 1.5 && jz > z0 - 1.5 && jz < z1 + 1.5)) continue;
      scene.add(buildTree(jx, jz, 0.9 + (seed % 4) * 0.12, seed));
    }
  }
  for (let x = 58; x < 128; x += 2.4) if (Math.abs(x - PX) > 3.5) scene.add(buildBush(x, 11.6, 0.9, seed++));
  for (let x = 57; x < 128; x += 2.2) scene.add(buildBush(x, 75, 1.1, seed++)); // janubiy chegara — buta to'sig'i
  // park bilan darvoza orasidagi maysazor — siyrak daraxtzor
  for (let x = 16; x <= 52; x += 6) for (let z = 15; z <= 72; z += 6) scene.add(buildTree(x + Math.sin(seed * 3.1) * 2, z + Math.cos(seed * 1.7) * 2, 0.9 + (seed % 3) * 0.15, seed++));

  return (time, dt) => {
    wheel.rotation.z += dt * 0.06;
    for (const c of cabins) c.rotation.z = -wheel.rotation.z + Math.sin(time * 0.8 + c.position.x) * 0.03;
    led.material.color.setHSL((time * 0.05) % 1, 0.9, 0.6);
    led.material.emissive.copy(led.material.color);
    spin.rotation.y += dt * 0.5;
    horses.forEach((h, i) => { h.position.y = 1.4 + Math.sin(time * 2 + i * 1.3) * 0.35; });
    // ko'tarilish ~8 s, tepada 2 s, tushish 1.5 s, pastda 3 s
    const tt = time % 14.5;
    seat.position.y = tt < 8 ? 3 + (20 * tt) / 8 : tt < 10 ? 23 : tt < 11.5 ? 23 - 20 * ((tt - 10) / 1.5) ** 2 : 3;
    train.forEach((car, i) => {
      const u = (time * 0.035 + 1 - i * 0.012) % 1;
      track.getPointAt(u, car.position);
      track.getPointAt((u + 0.003) % 1, p);
      car.lookAt(scene.localToWorld(p));
    });
    jets.forEach((j, i) => { j.scale.y = i === 8 ? 3 + Math.sin(time * 2.2) * 0.8 : 1.4 + Math.max(0, Math.sin(time * 3 + i * 0.8)) * 1.6; });
    // arg'imchoq: 20 s aylanadi, 8 s to'xtaydi — sekin tezlashib, sekin to'xtaydi
    const sp = time % 28;
    const run = sp < 20 ? smooth(Math.min(1, sp / 4)) * smooth(Math.min(1, (20 - sp) / 4)) : 0;
    swingTop.rotation.y += dt * 1.5 * run;
    swingTop.rotation.x = Math.sin(time * 0.6) * 0.05 * run;
    for (const pv of swings) pv.rotation.z = 0.06 + 0.85 * run;
    teacups.rotation.y += dt * 0.45;
    cups.forEach((c, i) => { c.rotation.y += dt * (1.2 + i * 0.25); });
    for (const b of bumpers) {
      const a = time * b.w + b.p;
      const a2 = time * b.w * 1.37 + b.p * 2;
      b.c.position.set(BC.x + Math.sin(a) * 5, 0.2, BC.z + Math.sin(a2) * 2.6);
      b.c.rotation.y = Math.atan2(Math.cos(a) * 5, Math.cos(a2) * 2.6 * 1.37);
    }
    for (const sw of swans) {
      const a = time * sw.w + sw.ph;
      sw.b.position.set(LK.x + Math.cos(a) * LK.rx * sw.r, 0.3 + Math.sin(time * 1.3 + sw.ph) * 0.04, LK.z + Math.sin(a) * LK.rz * sw.r);
      sw.b.rotation.y = Math.atan2(-Math.sin(a) * LK.rx, Math.cos(a) * LK.rz);
    }
    kidTrain.forEach((car, i) => {
      const u = (((time * 0.012 - i * 0.026) % 1) + 1) % 1;
      trainPath.getPointAt(u, car.position);
      trainPath.getPointAt((u + 0.004) % 1, p);
      car.lookAt(scene.localToWorld(p));
    });
    // qaroqchi kemasi: 24 s tebranadi (amplituda o'sib-kamayadi), 6 s tinch
    const ph = time % 30;
    shipPivot.rotation.x = (ph < 24 ? Math.sin((Math.PI * ph) / 24) * 1.05 : 0) * Math.sin((time * 2 * Math.PI) / 4.6);
    for (const w of strollers) {
      w.s = (w.s + (dt * w.speed) / w.len) % 1;
      w.loop.getPointAt(w.s, w.pp.position);
      const tn = w.loop.getTangentAt(w.s);
      w.pp.rotation.y = Math.atan2(-tn.z, tn.x);
      poseGuard(w.pp, 'walk', time, dt, null);
    }
  };
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
    const x = 16 + i * 6;
    // aylanma yo'l: trotuar → mall oldidagi maydon → eshik → qaytish; ikkitasi ko'prikda
    const zb = -24.4 - (i - 3) * 0.9;
    const pts = i >= 3
      ? [[49.4, 6.4, zb], [56.4, 6.4, zb], [56.6, 6.4, zb - 0.35], [49.2, 6.4, zb - 0.35]]
      : [[x + 34, 0, -6.4], [x + 52, 0, -6.4], [87 + (i - 1) * 0.8, 0, -12.6], [80 + i, 0, -8.8], [x + 42, 0, -6.1]];
    const loop = new THREE.CatmullRomCurve3(pts.map(([px, py, pz]) => new THREE.Vector3(px, py, pz)), true, 'centripetal');
    return { p, loop, len: loop.getLength(), s: (i * 0.23) % 1, speed: 1.0 + (i % 3) * 0.15 };
  });
}

// Ikki qorovul: budkadagi — keksaroq, yashil forma, oq mo'ylov; tashqaridagi — yosh, ko'k forma, jilet
const GUARD_SEATED = { uniform: 0x2f4a3a, cap: 0x23362b, skin: 0xd9a77e, mustache: 0xd8d8d8, vest: false, girth: 1.15, brows: 0xbfbfbf };
const GUARD_OUTSIDE = { uniform: 0x24448f, cap: 0x1b2a55, skin: 0xe8b98f, mustache: null, vest: true, girth: 1, brows: 0x3a2a20 };

export default function Gate3D({ lot = 1, event, arrival, reject, release, spots, focusZone, onPlateRead }) {
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
    scene.fog = new THREE.Fog(0xd8d3c8, 190, 520);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    renderer.toneMappingExposure = 1.05;
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 700);
    const plateCam = new THREE.PerspectiveCamera(12, 16 / 10, 0.1, 40); // tor burchakli raqam kamerasi

    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30343a, 1.3));
    const sun = new THREE.DirectionalLight(0xffe7c4, 2.6); // past quyosh — uzun soyalar
    sun.position.set(23, 84, 112);
    sun.target.position.set(95, 0, 28);
    scene.add(sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 95, bottom: -95, far: 330 });
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    // Shahar (yo'l, mall, park, arena, boshqa garaj) — alohida guruh; darvoza va shu stoyankaning garaji joyida
    const city = new THREE.Group();
    scene.add(city);
    const barriers = buildWorld(city, scene);
    const garage = buildGarage(scene);
    const mall = buildMall(city);
    const walkers = buildWalkers(city);
    const park = buildPark(city);
    const arena = buildArena(city);
    buildLuxury(city);
    // Boshqa stoyankaning garaji (bezak): 1-stoyankada — park yonida, 2-stoyankada — mall yonida
    const garage2Root = new THREE.Group();
    if (lot !== 2) {
      garage2Root.position.x = 188;
      garage2Root.rotation.y = Math.PI;
    }
    city.add(garage2Root);
    const garage2 = buildGarage(garage2Root);
    garage2Root.traverse((o) => o.isLight && (o.visible = false)); // ichki chiroqlar uzoqdan ko'rinmaydi, faqat sahnani sekinlashtiradi
    fillGarage(garage2);
    if (lot === 2) city.applyMatrix4(MIRROR);

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

      // Piyodalar savdo markaziga borib-kelishadi
      for (const wk of walkers) {
        wk.s = (wk.s + (dt * wk.speed) / wk.len) % 1;
        const p = wk.loop.getPointAt(wk.s);
        const tn = wk.loop.getTangentAt(wk.s);
        wk.p.position.copy(p);
        wk.p.rotation.y = Math.atan2(-tn.z, tn.x);
        poseGuard(wk.p, 'walk', time, dt, null);
      }
      park(time, dt);
      arena(time);
      mall.userData.revolve.rotation.y += dt * 0.5;
      for (const cloth of mall.userData.flags) {
        const a = cloth.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) a.setZ(i, Math.sin(a.getX(i) * 7 + time * 6) * 0.06 * (a.getX(i) + 0.45));
        a.needsUpdate = true;
      }

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
