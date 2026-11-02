// Umumiy 3D qismlar: yordamchilar, mashina, qorovul/personaj skeleti va pozalari.
// Darvoza sahnasi (Gate3D) va kirish sahifasi (LoginScene) ishlatadi.
import * as THREE from 'three';

export const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const smooth = (t) => t * t * (3 - 2 * t);
export const seg = (t, a, b) => clamp01((t - a) / (b - a));
export const lerp = (a, b, t) => a + (b - a) * t;
// Burchakni eng qisqa yo'l bilan yaqinlashtirish
export const lerpAngle = (a, b, t) => a + (((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * t;

export const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });
export function mesh(geo, material, { x = 0, y = 0, z = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}
export const box = (w, h, d, material, pos) => mesh(new THREE.BoxGeometry(w, h, d), material, pos);

// Davlat raqami teksturasi: oq plastinka, chapda hudud kodi
export function drawPlate(ctx, plate) {
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

// ---------- Mashina: kuzov turi (sedan / suv / sport), lakli bo'yoq, xrom, g'ildirak arkalari ----------
// Profil — yon ko'rinish nuqtalari (x: uzunlik, y: balandlik); spline bilan silliq siqib chiqariladi
const CAR_TYPES = {
  sedan: {
    lower: [[-1.13, 0.26], [1.1, 0.26], [1.19, 0.4], [1.15, 0.56], [0.6, 0.65], [-0.2, 0.67], [-0.96, 0.67], [-1.14, 0.52]],
    cabin: [[0.58, 0.64], [0.32, 0.86], [0.1, 0.97], [-0.5, 0.97], [-0.8, 0.86], [-0.95, 0.65]],
    width: 0.96, wheelR: 0.25, wheelX: 0.72, plateY: 0.36, headY: 0.5, tailY: 0.56,
  },
  suv: {
    lower: [[-1.16, 0.32], [1.12, 0.32], [1.22, 0.48], [1.2, 0.74], [0.75, 0.82], [-0.3, 0.84], [-1.1, 0.84], [-1.18, 0.62]],
    cabin: [[0.72, 0.81], [0.5, 1.08], [0.35, 1.18], [-1.0, 1.19], [-1.08, 1.05], [-1.1, 0.83]],
    width: 1.04, wheelR: 0.3, wheelX: 0.74, plateY: 0.44, headY: 0.68, tailY: 0.72,
  },
  sport: {
    lower: [[-1.16, 0.22], [1.15, 0.22], [1.24, 0.3], [1.18, 0.42], [0.45, 0.53], [-0.4, 0.58], [-0.98, 0.58], [-1.18, 0.46]],
    cabin: [[0.38, 0.54], [0.15, 0.72], [-0.1, 0.8], [-0.5, 0.8], [-0.78, 0.68], [-0.95, 0.57]],
    width: 1.02, wheelR: 0.24, wheelX: 0.74, plateY: 0.31, headY: 0.42, tailY: 0.5,
  },
};

function profileShape(points) {
  const s = new THREE.Shape();
  s.moveTo(...points[0]);
  s.lineTo(...points[1]);
  s.splineThru(points.slice(2).map(([x, y]) => new THREE.Vector2(x, y)));
  s.closePath();
  return s;
}

let blobTex = null;
function contactShadow(len, width) {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,.75)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, width), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.025;
  m.renderOrder = 1;
  return m;
}

export function buildCar(type = 'sedan') {
  const T = CAR_TYPES[type] || CAR_TYPES.sedan;
  const half = T.width / 2;
  const car = new THREE.Group();
  const body = new THREE.Group(); // osma: burun egilishi shu guruhda
  car.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0d141c, metalness: 0.2, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.92 });
  const chrome = mat(0xd9dde3, { metalness: 1, roughness: 0.12 });
  const black = mat(0x111214, { roughness: 0.6 });

  const lowerGeo = new THREE.ExtrudeGeometry(profileShape(T.lower), { depth: T.width - 0.08, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.06, bevelSegments: 4, curveSegments: 18 });
  lowerGeo.translate(0, 0, -(T.width - 0.08) / 2);
  body.add(mesh(lowerGeo, paint));
  const cabinGeo = new THREE.ExtrudeGeometry(profileShape(T.cabin), { depth: T.width - 0.2, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.04, bevelSegments: 3, curveSegments: 14 });
  cabinGeo.translate(0, 0, -(T.width - 0.2) / 2);
  body.add(mesh(cabinGeo, glass));
  // Tom va ustunlar — bo'yoq rangida (oyna faqat derazalarda ko'rinadi)
  const roofTop = Math.max(...T.cabin.map((p) => p[1]));
  const roofXs = T.cabin.filter((p) => p[1] > roofTop - 0.02).map((p) => p[0]);
  const roofW = Math.max(...roofXs) - Math.min(...roofXs) + 0.1;
  body.add(box(roofW, 0.035, T.width - 0.16, paint, { x: (Math.max(...roofXs) + Math.min(...roofXs)) / 2, y: roofTop + 0.025 }));
  for (const px of [T.cabin[0][0] - 0.06, (T.cabin[0][0] + T.cabin.at(-1)[0]) / 2, T.cabin.at(-1)[0] + 0.05]) {
    body.add(box(0.05, roofTop - T.cabin[0][1], T.width - 0.15, paint, { x: px, y: (roofTop + T.cabin[0][1]) / 2 }));
  }
  // Xrom bel chizig'i, eshik chiziqlari, tutqichlar
  const belt = T.cabin[0][1] - 0.01;
  for (const z of [half + 0.035, -half - 0.035]) {
    body.add(box(Math.abs(T.cabin[0][0] - T.cabin.at(-1)[0]), 0.012, 0.01, chrome, { x: (T.cabin[0][0] + T.cabin.at(-1)[0]) / 2, y: belt, z, shadow: false }));
    body.add(box(0.005, belt - T.lower[0][1] - 0.08, 0.005, black, { x: -0.12, y: (belt + T.lower[0][1]) / 2, z, shadow: false }));
    for (const hx of [0.18, -0.45]) body.add(box(0.09, 0.02, 0.012, chrome, { x: hx, y: belt - 0.08, z, shadow: false }));
    // yon oyna
    const mirror = box(0.12, 0.07, 0.1, paint, { x: T.cabin[0][0] - 0.1, y: belt + 0.04, z: z + Math.sign(z) * 0.04 });
    mirror.add(box(0.02, 0.05, 0.07, glass, { x: -0.06 }));
    body.add(mirror);
  }
  // Old: panjara, faralar (xrom hoshiya), kunduzgi chiroq; orqa: stop-chiroqlar
  const front = Math.max(...T.lower.map((p) => p[0])) + 0.04;
  const rear = Math.min(...T.lower.map((p) => p[0])) - 0.04;
  body.add(box(0.03, 0.1, T.width * 0.5, black, { x: front + 0.005, y: T.headY - 0.03, shadow: false }));
  for (let i = 0; i < 3; i++) body.add(box(0.032, 0.008, T.width * 0.48, chrome, { x: front + 0.008, y: T.headY - 0.065 + i * 0.03, shadow: false }));
  const head = mat(0xfff3c4, { emissive: 0xfff3c4, emissiveIntensity: 1.6, roughness: 0.1 });
  const tail = mat(0x8a1c20, { emissive: 0xe5484d, emissiveIntensity: 0.4 });
  for (const z of [half - 0.17, -half + 0.17]) {
    body.add(box(0.03, 0.08, 0.22, chrome, { x: front - 0.005, y: T.headY, z, shadow: false }));
    body.add(box(0.032, 0.06, 0.19, head, { x: front + 0.002, y: T.headY, z, shadow: false }));
    body.add(box(0.03, 0.08, 0.26, tail, { x: rear + 0.01, y: T.tailY, z, shadow: false }));
  }
  body.add(box(0.035, 0.05, T.width - 0.02, mat(0x202226), { x: front + 0.01, y: T.lower[0][1] + 0.02, shadow: false })); // bamper
  body.add(box(0.035, 0.05, T.width - 0.02, mat(0x202226), { x: rear - 0.005, y: T.lower[0][1] + 0.03, shadow: false }));

  // Raqam: kuzov sirtidan oldinda (bevel ichida qolib ketmasin), o'z yorug'ligi bilan
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const plateTex = new THREE.CanvasTexture(canvas);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  plateTex.anisotropy = 4;
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, emissiveMap: plateTex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.4 });
  const fp = mesh(new THREE.PlaneGeometry(0.42, 0.092), plateMat, { x: front + 0.04, y: T.plateY, shadow: false });
  fp.rotation.y = Math.PI / 2;
  const bp = mesh(new THREE.PlaneGeometry(0.42, 0.092), plateMat, { x: rear - 0.03, y: T.plateY + 0.04, shadow: false });
  bp.rotation.y = -Math.PI / 2;
  body.add(fp, bp);

  // G'ildiraklar: shina, disk, bolt halqasi; ustida qora arka
  const wheels = [];
  const tire = mat(0x141414, { roughness: 0.95 });
  const rim = mat(0xc9ccd1, { roughness: 0.2, metalness: 0.95 });
  const r = T.wheelR;
  for (const [x, z] of [[T.wheelX, half], [-T.wheelX, half], [T.wheelX, -half], [-T.wheelX, -half]]) {
    const arch = mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.06, 24, 1, false, -Math.PI / 2, Math.PI), black, { x, y: r + 0.01, z: z + Math.sign(z) * 0.005, shadow: false });
    arch.rotation.x = Math.PI / 2;
    body.add(arch);
    const w = new THREE.Group();
    w.position.set(x, r, z - Math.sign(z) * 0.02);
    const t = mesh(new THREE.TorusGeometry(r - 0.06, 0.07, 10, 28), tire);
    const d = mesh(new THREE.CylinderGeometry(r - 0.07, r - 0.07, 0.16, 20), rim, { shadow: false });
    d.rotation.x = Math.PI / 2;
    const hub = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.17, 10), black, { shadow: false });
    hub.rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const spoke = box(0.03, (r - 0.08) * 1.8, 0.02, rim, { z: Math.sign(z) * 0.075, shadow: false });
      spoke.rotation.z = (i / 5) * Math.PI;
      w.add(spoke);
    }
    w.add(t, d, hub);
    car.add(w);
    wheels.push(w);
  }
  car.add(contactShadow(2.9, T.width + 0.55));
  const setPlate = (plate) => {
    drawPlate(canvas.getContext('2d'), plate);
    plateTex.needsUpdate = true;
  };
  car.userData = { body, paint, tail, wheels, setPlate, type, front, plateY: T.plateY, wheelR: r, v: 0, a: 0, lastX: null };
  return car;
}

// ---------- Qorovul: tizza va tirsakli skelet, yumaloq (kapsula) a'zolar, yuz ----------
export const capsule = (r, len, material, pos) => mesh(new THREE.CapsuleGeometry(r, len, 6, 14), material, pos);

export function buildGuard(o) {
  const g = new THREE.Group();
  const skin = mat(o.skin, { roughness: 0.6 });
  const uniform = mat(o.uniform, { roughness: 0.8 });
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
  chest.scale.set(0.85 * o.girth, 1, 1.4 * Math.sqrt(o.girth)); // gavda
  torso.add(chest);
  const vest = mat(0xf2c230, { emissive: 0xf2c230, emissiveIntensity: 0.25, roughness: 0.6 });
  const strip = mat(0xdfe3ea, { emissive: 0xdfe3ea, emissiveIntensity: 0.35 });
  const band = (y, m, h) => {
    const b = mesh(new THREE.CylinderGeometry(1, 1, h, 24, 1, true), m, { y });
    b.scale.set(0.155, 1, 0.245);
    torso.add(b);
  };
  if (o.vest) {
    band(0.42, vest, 0.1);
    band(0.31, strip, 0.05);
  } else if (o.tie) {
    // kostyum: oq ko'ylak yoqasi va galstuk
    torso.add(box(0.012, 0.16, 0.13, mat(0xf4f3ef), { x: 0.152 * o.girth, y: 0.52, shadow: false }));
    torso.add(box(0.014, 0.34, 0.05, mat(o.tie, { metalness: o.tieMetal ? 0.7 : 0, roughness: 0.35 }), { x: 0.158 * o.girth, y: 0.38, shadow: false }));
    for (const z of [-0.06, 0.06]) torso.add(box(0.01, 0.22, 0.03, mat(o.uniform), { x: 0.158 * o.girth, y: 0.5, z, shadow: false })); // latskan
  } else if (o.epaulets !== false) {
    torso.add(box(0.02, 0.5, 0.012, mat(0xd9b44a, { metalness: 0.8 }), { x: 0.15 * o.girth, y: 0.35, shadow: false })); // tugmalar chizig'i
    for (const z of [-0.2, 0.2]) torso.add(box(0.22, 0.03, 0.14, mat(0xd9b44a, { metalness: 0.7 }), { y: 0.6, z })); // pogon
  }
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
  for (const z of [-0.05, 0.05]) head.add(box(0.02, 0.014, 0.05, mat(o.brows), { x: 0.13, y: 0.065, z, shadow: false })); // qosh
  head.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), skin, { x: 0.145, y: -0.01 })); // burun
  if (o.mustache) head.add(box(0.03, 0.028, 0.11, mat(o.mustache), { x: 0.138, y: -0.05, shadow: false })); // mo'ylov
  if (o.cap) {
    head.add(mesh(new THREE.CylinderGeometry(0.15, 0.155, 0.08, 24), mat(o.cap), { y: 0.12 }));
    head.add(mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.02, 24), mat(0x0f1733), { y: 0.085 }));
    const visor = box(0.14, 0.015, 0.24, dark, { x: 0.15, y: 0.09 });
    visor.rotation.z = -0.2;
    head.add(visor);
    head.add(box(0.012, 0.04, 0.05, mat(0xd9b44a, { metalness: 0.8 }), { x: 0.155, y: 0.13 })); // kokarda
  } else if (o.hair) {
    const hair = mesh(new THREE.SphereGeometry(0.148, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(o.hair, { roughness: 0.5 }), { x: -0.01, y: 0.03 });
    hair.scale.set(1.02, 1.05, 1);
    head.add(hair);
  }
  if (o.glasses) {
    const frame = mat(o.glasses === 'shades' ? 0x0a0a0a : 0x2a2a2a, { metalness: 0.6, roughness: 0.2 });
    for (const z of [-0.05, 0.05]) head.add(box(0.012, o.glasses === 'shades' ? 0.04 : 0.035, 0.06, frame, { x: 0.142, y: 0.028, z, shadow: false }));
    head.add(box(0.01, 0.01, 0.04, frame, { x: 0.145, y: 0.035, shadow: false }));
  }

  // Qo'l: yelka → tirsak → kaft
  const arms = [-0.25, 0.25].map((z) => {
    const upper = new THREE.Group();
    upper.position.set(0, 0.56, z);
    upper.add(capsule(0.058, 0.22, uniform, { y: -0.15 }));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    elbow.add(capsule(0.05, 0.2, uniform, { y: -0.12 }));
    elbow.add(mesh(new THREE.SphereGeometry(0.05, 12, 10), skin, { y: -0.29 }));
    if (o.watch && z < 0) elbow.add(box(0.06, 0.03, 0.07, mat(0xd4a017, { metalness: 0.9, roughness: 0.2 }), { y: -0.22 })); // oltin soat
    upper.add(elbow);
    torso.add(upper);
    return { upper, elbow };
  });

  g.userData = { hips, torso, neck, head, legs, arms, eyes, walk: 0, blink: 2 };
  return g;
}

// Holat bo'yicha qorovul pozasi. mode: idle | walk | wave | shout. Har bo'g'in yumshoq yaqinlashadi.
export function poseGuard(guard, mode, time, dt, lookAt) {
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
  } else if (mode === 'sit' || mode === 'sitwave') {
    // stulda: son gorizontal, boldir pastga, qo'llar stolda; vaqti-vaqti bilan klaviaturada yozadi
    T.th = [Math.PI / 2, Math.PI / 2];
    T.kn = [Math.PI / 2, Math.PI / 2];
    const typing = Math.sin(time * 0.5) > 0.3 ? Math.sin(time * 18) * 0.06 : 0;
    T.up = [[0.75, 0.15], [0.75 + typing, -0.15]];
    T.el = [[0.85, 0], [0.85 - typing, 0]];
    T.lean = 0.08;
    if (mode === 'sitwave') {
      T.up[1] = [0.3, -2.5];
      T.el[1] = [0, -0.35 + Math.sin(time * 9) * 0.45];
      T.lean = 0;
    }
  } else if (mode === 'cheer') {
    // xursand: sakraydi, ikki qo'l tepada silkinadi
    const j = Math.max(0, Math.sin(time * 7));
    T.bob = j * 0.18;
    T.kn = [0.15 + (1 - j) * 0.5, 0.15 + (1 - j) * 0.5];
    T.th = [-(1 - j) * 0.3, -(1 - j) * 0.3];
    T.up = [[0.2, 2.6 + Math.sin(time * 14) * 0.2], [0.2, -2.6 - Math.sin(time * 14) * 0.2]];
    T.el = [[0, 0.3], [0, -0.3]];
  } else if (mode === 'sad') {
    T.up = [[0.05, 0.02], [0.05, -0.02]];
    T.lean = 0.12;
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
  const sitting = mode === 'sit' || mode === 'sitwave';
  u.hips.position.y = lerp(u.hips.position.y, sitting ? 0.5 : 0.92 + T.bob - (mode === 'shout' ? 0.03 : 0), k);
  u.hips.position.z = lerp(u.hips.position.z, T.sway, Math.min(1, dt * 3));

  // Ko'z qisish
  u.blink -= dt;
  const closed = u.blink < 0.12;
  if (u.blink < 0) u.blink = 2 + Math.random() * 3;
  for (const e of u.eyes) e.scale.y = closed ? 0.15 : 1;

  // Bosh: nishonga qaraydi, bo'lmasa sekin atrofga
  const local = lookAt ? guard.worldToLocal(lookAt.clone()) : null;
  const yaw = mode === 'cheer' ? 0 : local ? THREE.MathUtils.clamp(Math.atan2(-local.z, local.x), -1.1, 1.1) : Math.sin(time * 0.35) * 0.6 + Math.sin(time * 1.3) * 0.08;
  u.neck.rotation.y = lerp(u.neck.rotation.y, yaw, Math.min(1, dt * 4));
  u.neck.rotation.z = mode === 'shout' ? Math.sin(time * 14) * 0.08 - 0.1 : mode === 'sad' ? -0.25 : lerp(u.neck.rotation.z, 0, k);
  if (mode === 'sad') u.neck.rotation.y = Math.sin(time * 9) * 0.45; // bosh chayqaydi
}

// Mashina fizikasi: tezlik, tezlanish → g'ildirak aylanishi, burun egilishi, stop-chiroq
export function driveCar(car, x, z, dt) {
  const u = car.userData;
  if (u.lastX === null) {
    u.lastX = x;
    u.lastZ = z;
  }
  // oldinga siljish: mashina qaragan yo'nalish bo'yicha (burilishlarda ham to'g'ri)
  const fwd = (x - u.lastX) * Math.cos(car.rotation.y) - (z - u.lastZ) * Math.sin(car.rotation.y);
  const v = dt > 0 ? fwd / dt : 0;
  const a = dt > 0 ? (v - u.v) / dt : 0;
  u.a = lerp(u.a, a, Math.min(1, dt * 6));
  u.v = v;
  u.lastX = x;
  u.lastZ = z;
  car.position.set(x, 0, z);
  for (const w of u.wheels) w.rotation.z -= fwd / u.wheelR;
  // tormozda burun pastga, tezlanishda orqaga cho'kadi
  u.body.rotation.z = lerp(u.body.rotation.z, THREE.MathUtils.clamp(u.a * -0.006, -0.05, 0.05), Math.min(1, dt * 8));
  u.body.position.y = Math.sin(performance.now() / 90) * 0.004 * Math.min(1, Math.abs(v) / 3); // yo'l titrashi
  const braking = Math.abs(v) < 0.3 || u.a * Math.sign(v || 1) < -0.5;
  u.tail.emissiveIntensity = lerp(u.tail.emissiveIntensity, braking ? 2.2 : 0.4, Math.min(1, dt * 10));
}
