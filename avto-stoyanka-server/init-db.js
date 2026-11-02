// Bazani tozadan yaratadi: jadvallar, 200 joy, tarif va profillar
import fs from 'node:fs';
import pg from 'pg';
import { hashPassword } from './lib.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const users = [
  ['admin', 'admin123', 'Bosh administrator', 'admin'],
  ['aziz', 'qorovul1', 'Aziz Karimov', 'guard'],
  ['bekzod', 'qorovul2', 'Bekzod Toshmatov', 'guard'],
  ['dilshod', 'qorovul3', 'Dilshod Rahimov', 'guard'],
];

await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
for (const [username, password, fullName, role] of users) {
  await pool.query('INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4)', [
    username, hashPassword(password), fullName, role,
  ]);
}
const { rows } = await pool.query('SELECT count(*)::int AS n FROM spots');
console.log(`Baza tayyor: ${rows[0].n} joy, ${users.length} profil`);
await pool.end();
