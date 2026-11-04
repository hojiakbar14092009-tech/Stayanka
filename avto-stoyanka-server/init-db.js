// Bazani tozadan yaratadi (bor ma'lumot o'chadi): npm run init-db
import pg from 'pg';
import { seed, users } from './seed.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await seed(pool);
const { rows } = await pool.query('SELECT count(*)::int AS n FROM spots');
console.log(`Baza tayyor: ${rows[0].n} joy, ${users.length} profil`);
await pool.end();
