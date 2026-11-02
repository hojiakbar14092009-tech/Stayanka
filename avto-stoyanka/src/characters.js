// Personajlar tavsifi (three.js siz — kirish sahifasi uni darhol, 3D esa keyin yuklaydi)
// Har bir kiruvchining o'z personaji. Boshliq — eng elegant: qora kostyum, oltin galstuk, qora ko'zoynak, oltin soat.
export const CHARACTERS = {
  guest: { name: 'Mehmon', uniform: 0x3a3d43, hair: 0x2a1d14, skin: 0xe8b98f, epaulets: false, girth: 1, brows: 0x3a2a20 },
  aziz: { name: 'Aziz, qorovul', uniform: 0x24448f, cap: 0x1b2a55, skin: 0xe8b98f, vest: true, girth: 1, brows: 0x3a2a20 },
  bekzod: { name: 'Bekzod, qorovul', uniform: 0x2f4a3a, cap: 0x23362b, skin: 0xd9a77e, mustache: 0x1a120c, girth: 1.12, brows: 0x1a120c },
  dilshod: { name: 'Dilshod, qorovul', uniform: 0x5a5f66, cap: 0x8a1c20, skin: 0xf0caa4, glasses: 'glasses', vest: true, girth: 0.92, brows: 0x6a4a2a },
  admin: { name: 'Bosh administrator', uniform: 0x1b2a55, hair: 0x1a1410, skin: 0xe0b088, tie: 0x2257d6, glasses: 'glasses', epaulets: false, girth: 1, brows: 0x1a1410 },
  boss: { name: 'Boshliq', uniform: 0x121212, hair: 0x0b0b0b, skin: 0xd9a77e, tie: 0xd4a017, tieMetal: true, glasses: 'shades', watch: true, mustache: 0x0b0b0b, epaulets: false, girth: 1.06, brows: 0x0b0b0b },
};
// Noma'lum xodimlar uchun ism asosida doimiy, lekin har xil forma
const PALETTE = [0x24448f, 0x2f4a3a, 0x5a3a7a, 0x7a4a1a, 0x1f6b6b];
export function characterFor(username = '', role = null) {
  const u = username.trim().toLowerCase();
  if (CHARACTERS[u]) return CHARACTERS[u];
  if (role === 'admin') return CHARACTERS.admin;
  if (!u) return CHARACTERS.guest;
  let h = 0;
  for (const c of u) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { name: role === 'guard' ? 'Qorovul' : 'Xodim', uniform: PALETTE[h % 5], cap: 0x1b2a55, skin: [0xe8b98f, 0xd9a77e, 0xc98f62][h % 3], vest: h % 2 === 0, mustache: h % 3 === 0 ? 0x2a1d14 : null, girth: 0.95 + (h % 3) * 0.07, brows: 0x3a2a20 };
}
