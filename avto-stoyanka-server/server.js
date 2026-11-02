// AvtoStoyanka API: Express + PostgreSQL (pg Pool). Port 3000.
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { hashPassword, checkPassword, makeToken, readToken, calcFee } from './lib.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(cors());
app.use(express.json());

// 4xx xatolar uchun: throw fail(400, '...')
const fail = (status, message) => Object.assign(new Error(message), { status });

// Mashina raqami: katta harf, bo'shliqsiz, 4–12 belgi
function normPlate(plate) {
  const p = String(plate || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{4,12}$/.test(p)) throw fail(400, "Mashina raqami 4–12 ta harf yoki raqam bo'lsin");
  return p;
}

async function getTariff(db = pool) {
  const { rows } = await db.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ---------- Real vaqt xabarlari (SSE) ----------
const clients = new Set();
function broadcast(event) {
  const line = `data: ${JSON.stringify({ ...event, at: new Date().toISOString() })}\n\n`;
  for (const res of clients) res.write(line);
}
setInterval(() => clients.forEach((res) => res.write(': ping\n\n')), 25000).unref();

// ---------- Kirish (login) va ruxsat ----------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 AND active', [String(username || '').trim()]);
  const user = rows[0];
  if (!user || !checkPassword(String(password || ''), user.password_hash)) throw fail(401, "Login yoki parol noto'g'ri");
  res.json({ token: makeToken(user), user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role } });
});

// Token: Authorization: Bearer ... yoki ?token=... (EventSource sarlavha yubora olmaydi)
async function auth(req, res, next) {
  const raw = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
  const payload = readToken(raw);
  if (!payload) return next(fail(401, 'Qaytadan kiring'));
  const { rows } = await pool.query('SELECT id, username, full_name, role FROM users WHERE id = $1 AND active', [payload.id]);
  if (!rows[0]) return next(fail(401, 'Profil faol emas'));
  req.user = rows[0];
  next();
}
const adminOnly = (req, res, next) => next(req.user.role === 'admin' ? undefined : fail(403, 'Faqat admin uchun'));

app.use('/api', auth);

app.get('/api/me', (req, res) => res.json(req.user));

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// ---------- 1. GET /api/spots — hamma joylar, id tartibida, ochiq sessiyasi bilan ----------
app.get('/api/spots', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.id, s.label, s.zone, s.is_premium, s.is_busy, s.is_disabled,
           se.id AS session_id, se.plate, se.entered_at, se.ticket_no, u.full_name AS guard_name
    FROM spots s
    LEFT JOIN sessions se ON se.spot_id = s.id AND se.left_at IS NULL
    LEFT JOIN users u ON u.id = se.guard_in
    ORDER BY s.id`);
  res.json(rows);
});

app.get('/api/tariff', async (req, res) => res.json(await getTariff()));

// ---------- 2. POST /api/enter — joy band, yangi sessiya ----------
// spot_id berilmasa — keyingi bo'sh oddiy joy (ketma-ket to'ldirish)
app.post('/api/enter', async (req, res) => {
  const plate = normPlate(req.body?.plate);
  const spotId = req.body?.spot_id ? Number(req.body.spot_id) : null;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const dup = await db.query(
      'SELECT s.label FROM sessions se JOIN spots s ON s.id = se.spot_id WHERE se.plate = $1 AND se.left_at IS NULL', [plate]);
    if (dup.rows[0]) throw fail(409, `${plate} allaqachon ${dup.rows[0].label} joyida turibdi`);

    const spot = spotId
      ? await db.query(
          'UPDATE spots SET is_busy = true WHERE id = $1 AND NOT is_busy AND NOT is_disabled RETURNING *', [spotId])
      : await db.query(`
          UPDATE spots SET is_busy = true WHERE id = (
            SELECT id FROM spots WHERE NOT is_busy AND NOT is_disabled
            ORDER BY is_premium, id LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING *`);
    if (!spot.rows[0]) throw fail(409, spotId ? 'Bu joy band yoki yopiq' : "Bo'sh joy qolmadi");

    const s = spot.rows[0];
    const ins = await db.query(
      'INSERT INTO sessions (spot_id, plate, guard_in) VALUES ($1, $2, $3) RETURNING id, entered_at', [s.id, plate, req.user.id]);
    // Kirish cheki raqami = QR kod matni. Tasodifiy qism — har mashinaga boshqa, taxmin qilib bo'lmaydi.
    const { id, entered_at } = ins.rows[0];
    const ticketNo = `T${entered_at.toISOString().slice(2, 10).replace(/-/g, '')}${String(id).padStart(5, '0')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await db.query('UPDATE sessions SET ticket_no = $2 WHERE id = $1', [id, ticketNo]);
    await db.query('COMMIT');
    broadcast({ type: 'enter', plate, label: s.label, is_premium: s.is_premium, guard: req.user.full_name });
    const ticket = {
      ticket_no: ticketNo, plate, label: s.label, spot_id: s.id, is_premium: s.is_premium,
      entered_at, active: true, guard_in_name: req.user.full_name, tariff: await getTariff(),
    };
    res.status(201).json({ spot: s, ticket });
  } catch (e) {
    await db.query('ROLLBACK');
    if (e.code === '23505') throw fail(409, 'Bu joy hozirgina band qilindi');
    throw e;
  } finally {
    db.release();
  }
});

// ---------- 3. PUT /api/exit/:spot_id — joy bo'sh, sessiya yopiladi, chek ----------
app.put('/api/exit/:spot_id', async (req, res) => {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const open = await db.query(`
      SELECT se.*, s.label, s.is_premium, now() AS now
      FROM sessions se JOIN spots s ON s.id = se.spot_id
      WHERE se.spot_id = $1 AND se.left_at IS NULL FOR UPDATE OF se`, [req.params.spot_id]);
    const se = open.rows[0];
    if (!se) throw fail(404, "Bu joyda mashina yo'q");

    const tariff = await getTariff(db);
    const fee = calcFee(se.now - se.entered_at, tariff, se.is_premium);
    const receiptNo = `CH-${se.now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(se.id).padStart(5, '0')}`;
    await db.query(
      'UPDATE sessions SET left_at = $2, fee = $3, guard_out = $4, receipt_no = $5 WHERE id = $1',
      [se.id, se.now, fee, req.user.id, receiptNo]);
    await db.query('UPDATE spots SET is_busy = false WHERE id = $1', [se.spot_id]);
    await db.query('COMMIT');

    const receipt = {
      receipt_no: receiptNo, ticket_no: se.ticket_no, plate: se.plate, label: se.label, is_premium: se.is_premium,
      entered_at: se.entered_at, left_at: se.now, fee, guard_out_name: req.user.full_name,
      hours: Math.max(1, Math.ceil((se.now - se.entered_at) / 3600000)), tariff,
    };
    broadcast({ type: 'exit', plate: se.plate, label: se.label, fee, guard: req.user.full_name });
    res.json(receipt);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
});

// ---------- 4. GET /api/revenue — bugungi tushum ----------
app.get('/api/revenue', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(fee), 0)::int AS total, count(*)::int AS count
    FROM sessions WHERE left_at >= date_trunc('day', now())`);
  res.json(rows[0]);
});

// ---------- Kirish chekini tekshirish (QR skaner) ----------
// Chek raqami yoki mashina raqami. active = mashina hali ichkarida.
app.get('/api/tickets/:code', async (req, res) => {
  const code = String(req.params.code).toUpperCase().replace(/[s-]/g, '');
  const { rows } = await pool.query(`
    SELECT se.id, se.ticket_no, se.receipt_no, se.plate, se.entered_at, se.left_at, se.fee, se.spot_id,
           s.label, s.zone, s.is_premium, se.left_at IS NULL AS active, gi.full_name AS guard_in_name
    FROM sessions se JOIN spots s ON s.id = se.spot_id
    LEFT JOIN users gi ON gi.id = se.guard_in
    WHERE replace(se.ticket_no, '-', '') = $1 OR se.plate = $1
    ORDER BY (replace(se.ticket_no, '-', '') = $1) DESC, se.left_at IS NULL DESC, se.entered_at DESC LIMIT 1`, [code]);
  if (!rows[0]) throw fail(404, "Bunday chek topilmadi");
  res.json({ ...rows[0], tariff: await getTariff() });
});

// ---------- Cheklar arxivi ----------
app.get('/api/receipts', async (req, res) => {
  const { q = '', from = null, to = null } = req.query;
  const { rows } = await pool.query(`
    SELECT se.id, se.receipt_no, se.ticket_no, se.plate, se.entered_at, se.left_at, se.fee,
           s.label, s.is_premium, gi.full_name AS guard_in_name, go.full_name AS guard_out_name
    FROM sessions se
    JOIN spots s ON s.id = se.spot_id
    LEFT JOIN users gi ON gi.id = se.guard_in
    LEFT JOIN users go ON go.id = se.guard_out
    WHERE se.left_at IS NOT NULL
      AND ($1 = '' OR se.plate ILIKE '%' || $1 || '%' OR replace(se.receipt_no, '-', '') ILIKE '%' || $1 || '%'
           OR replace(se.ticket_no, '-', '') ILIKE '%' || $1 || '%')
      AND ($2::date IS NULL OR se.left_at >= $2::date)
      AND ($3::date IS NULL OR se.left_at < $3::date + 1)
    ORDER BY se.left_at DESC LIMIT 300`, [String(q).trim().replace(/[\s-]/g, ''), from || null, to || null]);
  res.json(rows);
});

// ---------- Admin ----------
app.use('/api/admin', adminOnly);

app.get('/api/admin/stats', async (req, res) => {
  const [zones, week, guards, today] = await Promise.all([
    pool.query(`
      SELECT zone, count(*)::int AS total,
             count(*) FILTER (WHERE is_busy)::int AS busy,
             count(*) FILTER (WHERE is_disabled)::int AS disabled
      FROM spots GROUP BY zone ORDER BY zone`),
    pool.query(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(se.fee), 0)::int AS total, count(se.id)::int AS count
      FROM generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d
      LEFT JOIN sessions se ON se.left_at >= d AND se.left_at < d + interval '1 day'
      GROUP BY d ORDER BY d`),
    pool.query(`
      SELECT u.id, u.full_name, count(se.id)::int AS exits, COALESCE(SUM(se.fee), 0)::int AS total
      FROM users u
      LEFT JOIN sessions se ON se.guard_out = u.id AND se.left_at >= date_trunc('day', now())
      WHERE u.role = 'guard' GROUP BY u.id ORDER BY total DESC`),
    pool.query(`
      SELECT COALESCE(SUM(fee), 0)::int AS total, count(*)::int AS count,
             COALESCE(round(avg(extract(epoch FROM left_at - entered_at)) / 60), 0)::int AS avg_minutes
      FROM sessions WHERE left_at >= date_trunc('day', now())`),
  ]);
  res.json({ zones: zones.rows, week: week.rows, guards: guards.rows, today: today.rows[0] });
});

// Joyni premium / ta'mirda qilish
app.put('/api/admin/spots/:id', async (req, res) => {
  const { is_premium = null, is_disabled = null } = req.body || {};
  const { rows } = await pool.query(`
    UPDATE spots SET is_premium = COALESCE($2, is_premium), is_disabled = COALESCE($3, is_disabled)
    WHERE id = $1 AND NOT (is_busy AND COALESCE($3, false)) RETURNING *`, [req.params.id, is_premium, is_disabled]);
  if (!rows[0]) throw fail(409, "Band joyni yopib bo'lmaydi — avval mashinani chiqaring");
  broadcast({ type: 'spot', label: rows[0].label });
  res.json(rows[0]);
});

app.get('/api/admin/settings', async (req, res) => res.json(await getTariff()));

app.put('/api/admin/settings', async (req, res) => {
  for (const key of ['base_hour', 'step_hour', 'premium_hour']) {
    const v = Number(req.body?.[key]);
    if (!Number.isInteger(v) || v < 0 || v > 10_000_000) throw fail(400, `${key} — musbat butun son bo'lsin`);
    await pool.query('UPDATE settings SET value = $2 WHERE key = $1', [key, v]);
  }
  broadcast({ type: 'tariff' });
  res.json(await getTariff());
});

// Qorovullar
app.get('/api/admin/users', async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, full_name, role, active FROM users ORDER BY id');
  res.json(rows);
});

app.post('/api/admin/users', async (req, res) => {
  const { username, password, full_name, role = 'guard' } = req.body || {};
  if (!/^[a-z0-9_]{3,20}$/.test(username || '')) throw fail(400, 'Login: 3–20 ta kichik lotin harf yoki raqam');
  if (String(password || '').length < 6) throw fail(400, "Parol kamida 6 belgi bo'lsin");
  if (!String(full_name || '').trim()) throw fail(400, 'Ism kiriting');
  if (!['admin', 'guard'].includes(role)) throw fail(400, "Rol noto'g'ri");
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, role, active',
      [username, hashPassword(password), full_name.trim(), role]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw fail(409, 'Bu login band');
    throw e;
  }
});

app.put('/api/admin/users/:id', async (req, res) => {
  const { full_name = null, password = null, active = null } = req.body || {};
  if (Number(req.params.id) === req.user.id && active === false) throw fail(400, "O'zingizni o'chira olmaysiz");
  if (password !== null && String(password).length < 6) throw fail(400, "Parol kamida 6 belgi bo'lsin");
  const { rows } = await pool.query(`
    UPDATE users SET full_name = COALESCE($2, full_name), password_hash = COALESCE($3, password_hash),
                     active = COALESCE($4, active)
    WHERE id = $1 RETURNING id, username, full_name, role, active`,
    [req.params.id, full_name?.trim() || null, password ? hashPassword(password) : null, active]);
  if (!rows[0]) throw fail(404, 'Profil topilmadi');
  res.json(rows[0]);
});

// Cheklari bor profil o'chmaydi (arxiv saqlanadi) — faqat nofaol qilinadi
app.delete('/api/admin/users/:id', async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw fail(400, "O'zingizni o'chira olmaysiz");
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (e) {
    if (e.code !== '23503') throw e;
    await pool.query('UPDATE users SET active = false WHERE id = $1', [req.params.id]);
    res.json({ deleted: false, deactivated: true });
  }
});

// ---------- Xatolar: 4xx — o'z matni, qolgani — 500 ----------
app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Serverda xato' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AvtoStoyanka server: http://localhost:${port}`));
