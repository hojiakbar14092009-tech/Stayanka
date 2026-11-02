// Sinov uchun 30 kunlik tarix: har kuni 120–170 ta mashina kirib-chiqqan (faqat yopilgan sessiyalar).
// Ishlatish: npm run demo. Haqiqiy ishda kerak emas.
import pg from 'pg';
import { calcFee } from './lib.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tariff = Object.fromEntries((await pool.query('SELECT key, value FROM settings')).rows.map((r) => [r.key, r.value]));
const spots = (await pool.query('SELECT id, is_premium FROM spots')).rows;
const guards = (await pool.query("SELECT id FROM users WHERE role = 'guard'")).rows.map((r) => r.id);
const L = 'ABCDEFHKMNOPSTXYZ';
const rnd = (n) => Math.floor(Math.random() * n);
const plate = () => `${String(rnd(9) * 10 + 10)}${L[rnd(17)]}${100 + rnd(900)}${L[rnd(17)]}${L[rnd(17)]}`;

const now = Date.now();
let total = 0;
for (let d = 29; d >= 0; d--) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - d);
  const n = 120 + rnd(50);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const spot = spots[rnd(spots.length)];
    const enter = day.getTime() + (6 + Math.random() * 16) * 3600000;
    const leave = enter + (0.3 + Math.random() * 5.5) * 3600000;
    if (leave > now - 60000) continue; // faqat tugagan sessiyalar
    const guard = guards[rnd(guards.length)];
    const paid = Math.random() > 0.02;
    rows.push([spot.id, plate(), new Date(enter), new Date(leave), calcFee(leave - enter, tariff, spot.is_premium), guard, guard, paid]);
  }
  for (const r of rows) {
    await pool.query(
      `INSERT INTO sessions (spot_id, plate, entered_at, left_at, fee, guard_in, guard_out, paid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`, r).then(({ rows: [{ id }] }) =>
      pool.query("UPDATE sessions SET receipt_no = $2 || lpad(id::text, 6, '0'), ticket_no = 'TDM' || lpad(id::text, 6, '0') WHERE id = $1", [id, r[7] ? 'DM-' : 'QZ-']));
  }
  total += rows.length;
}
console.log(`Sinov tarixi qo'shildi: ${total} ta sessiya, 30 kun`);
await pool.end();
