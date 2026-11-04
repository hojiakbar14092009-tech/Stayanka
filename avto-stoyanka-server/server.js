// AvtoStoyanka API: Express + PostgreSQL (pg Pool). Port 3000.
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { hashPassword, checkPassword, makeToken, readToken, calcFee } from './lib.js';
import { migrateBoss, mountBoss, mountBossAdmin } from './boss.js';
import { seed } from './seed.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Lokal PGlite (PG_POOL_MAX=1): bitta ulanish va u hech yopilmaydi — qayta ulanishda PGlite qotib qoladi
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: process.env.PG_POOL_MAX ? 0 : 10000,
  // Qotmaslik: so'rov 10 s da, bo'sh ulanish kutish 8 s da xato bilan tugaydi (abadiy kutib qolmaydi)
  query_timeout: 10000,
  connectionTimeoutMillis: 8000,
});
process.on('unhandledRejection', (e) => console.error('Kutilmagan xato:', e?.message || e));
const app = express();
// Ochiq sayt (stayanka.vercel.app) shu kompyuterdagi serverga murojaat qilsa, Chrome shu ruxsatni so'raydi
app.use((req, res, next) => (res.set('Access-Control-Allow-Private-Network', 'true'), next()));
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
  res.json({ token: makeToken(user), user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, lot: user.lot } });
});

// Token: Authorization: Bearer ... yoki ?token=... (EventSource sarlavha yubora olmaydi)
async function auth(req, res, next) {
  const raw = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
  const payload = readToken(raw);
  if (!payload) return next(fail(401, 'Qaytadan kiring'));
  const { rows } = await pool.query('SELECT id, username, full_name, role, lot FROM users WHERE id = $1 AND active', [payload.id]);
  if (!rows[0]) return next(fail(401, 'Profil faol emas'));
  req.user = rows[0];
  next();
}
// Qaysi stoyanka: qorovul — o'ziga biriktirilgani; admin — ?lot= (berilmasa null = ikkalasi)
const lotOf = (req) => (req.user.role === 'guard' ? req.user.lot || 1 : [1, 2].includes(Number(req.query.lot)) ? Number(req.query.lot) : null);
const adminOnly = (req, res, next) => next(req.user.role === 'admin' ? undefined : fail(403, 'Faqat admin uchun'));

// Holat tekshiruvi (yuklanish ekrani va oflayn rejim uchun) — tokensiz
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Boshliq sahifasi — login emas, maxfiy havola kaliti bilan
mountBoss(app, pool, fail);

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
    SELECT s.id, s.label, s.zone, s.is_premium, s.is_busy, s.is_disabled, s.is_accessible,
           se.id AS session_id, se.plate, se.entered_at, se.ticket_no, se.disabled_driver, u.full_name AS guard_name
    FROM spots s
    LEFT JOIN sessions se ON se.spot_id = s.id AND se.left_at IS NULL
    LEFT JOIN users u ON u.id = se.guard_in
    WHERE s.lot = $1
    ORDER BY s.id`, [lotOf(req) || 1]);
  res.json(rows);
});

app.get('/api/tariff', async (req, res) => res.json(await getTariff()));

// ---------- 2. POST /api/enter — joy band, yangi sessiya ----------
// spot_id berilmasa — keyingi bo'sh joy: blok to'lmaguncha keyingisiga o'tmaydi (id tartibi = B-01..B-40, C-01..).
// Premium joy faqat mijoz xohlasa (premium: true) — oddiy mashina hech qachon avtomatik premiumga tushmaydi.
app.post('/api/enter', enterCar);
async function enterCar(req, res) {
  const plate = normPlate(req.body?.plate);
  const spotId = req.body?.spot_id ? Number(req.body.spot_id) : null;
  const premium = req.body?.premium === true;
  // Nogironlik guvohnomasi: to'xtash bepul, avval nogironlar joyiga qo'yiladi
  const disabledDriver = req.body?.disabled_driver === true;
  const lot = lotOf(req) || 1;
  const db = await pool.connect();
  let broken = false;
  try {
    await db.query('BEGIN');
    const dup = await db.query(
      'SELECT s.label, s.lot FROM sessions se JOIN spots s ON s.id = se.spot_id WHERE se.plate = $1 AND se.left_at IS NULL', [plate]);
    if (dup.rows[0]) throw fail(409, `${plate} allaqachon ${dup.rows[0].lot}-stoyanka ${dup.rows[0].label} joyida turibdi`);

    // Nogironlar joyiga faqat guvohnomasi borlar qo'yiladi
    const spot = spotId
      ? await db.query(
          'UPDATE spots SET is_busy = true WHERE id = $1 AND lot = $3 AND NOT is_busy AND NOT is_disabled AND (NOT is_accessible OR $2) RETURNING *', [spotId, disabledDriver, lot])
      : await db.query(`
          UPDATE spots SET is_busy = true WHERE id = (
            SELECT id FROM spots WHERE lot = $3 AND NOT is_busy AND NOT is_disabled AND is_premium = $1 AND ($2 OR NOT is_accessible)
            ORDER BY ($2 AND is_accessible) DESC, random() LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING *`, [premium, disabledDriver, lot]);
    if (!spot.rows[0]) {
      throw fail(409, spotId ? 'Bu joy band, yopiq yoki nogironlar uchun ajratilgan' : premium ? "Bo'sh VIP joy qolmadi" : "Bo'sh oddiy joy qolmadi");
    }

    const s = spot.rows[0];
    // Avval haydab chiqarilgan bo'lsa — to'lanmagan qarzi
    const debt = await db.query('SELECT COALESCE(SUM(fee), 0)::int AS sum FROM sessions WHERE plate = $1 AND NOT paid', [plate]);
    const ins = await db.query(
      'INSERT INTO sessions (spot_id, plate, guard_in, disabled_driver) VALUES ($1, $2, $3, $4) RETURNING id, entered_at', [s.id, plate, req.user.id, disabledDriver]);
    // Kirish cheki raqami = QR kod matni. Tasodifiy qism — har mashinaga boshqa, taxmin qilib bo'lmaydi.
    const { id, entered_at } = ins.rows[0];
    const ticketNo = `T${entered_at.toISOString().slice(2, 10).replace(/-/g, '')}${String(id).padStart(5, '0')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await db.query('UPDATE sessions SET ticket_no = $2 WHERE id = $1', [id, ticketNo]);
    await db.query('COMMIT');
    const debtSum = debt.rows[0].sum;
    broadcast({ type: 'enter', lot, plate, label: s.label, is_premium: s.is_premium, disabled_driver: disabledDriver, guard: req.user.full_name, debt: debtSum });
    const ticket = {
      ticket_no: ticketNo, plate, label: s.label, spot_id: s.id, is_premium: s.is_premium, disabled_driver: disabledDriver, debt: debtSum,
      entered_at, active: true, guard_in_name: req.user.full_name, tariff: await getTariff(db),
    };
    res.status(201).json({ spot: s, ticket });
  } catch (e) {
    await db.query('ROLLBACK').catch(() => (broken = true));
    if (/timeout/i.test(e.message)) broken = true;
    if (e.code === '23505') throw fail(409, 'Bu joy hozirgina band qilindi');
    throw e;
  } finally {
    db.release(broken);
  }
}

// ---------- 3. PUT /api/exit/:spot_id — joy bo'sh, sessiya yopiladi, chek ----------
// PUT /api/expel/:spot_id — mijoz to'lay olmadi: qorovul haydab chiqaradi, summa qarz bo'lib yoziladi
app.put('/api/exit/:spot_id', (req, res) => closeSession(req, res, true));
app.put('/api/expel/:spot_id', (req, res) => closeSession(req, res, false));

async function closeSession(req, res, paid) {
  const db = await pool.connect();
  let broken = false;
  try {
    await db.query('BEGIN');
    const open = await db.query(`
      SELECT se.*, s.label, s.is_premium, s.lot, now() AS now
      FROM sessions se JOIN spots s ON s.id = se.spot_id
      WHERE se.spot_id = $1 AND se.left_at IS NULL AND ($2::int IS NULL OR s.lot = $2) FOR UPDATE OF se`, [req.params.spot_id, lotOf(req)]);
    const se = open.rows[0];
    if (!se) throw fail(404, "Bu joyda mashina yo'q");
    const stolen = await db.query('SELECT 1 FROM stolen_found WHERE session_id = $1', [se.id]);
    if (stolen.rows[0]) throw fail(409, "Bu mashina o'g'irlangan deb topilgan: chiqarilmaydi, militsiyaga topshiriladi");

    const tariff = await getTariff(db);
    const fee = se.disabled_driver ? 0 : calcFee(se.now - se.entered_at, tariff, se.is_premium); // nogironlar uchun bepul
    const receiptNo = `${paid ? 'CH' : 'QZ'}-${se.now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(se.id).padStart(5, '0')}`;
    await db.query(
      'UPDATE sessions SET left_at = $2, fee = $3, guard_out = $4, receipt_no = $5, paid = $6 WHERE id = $1',
      [se.id, se.now, fee, req.user.id, receiptNo, paid]);
    await db.query('UPDATE spots SET is_busy = false WHERE id = $1', [se.spot_id]);
    await db.query('COMMIT');

    const receipt = {
      receipt_no: receiptNo, ticket_no: se.ticket_no, plate: se.plate, label: se.label, is_premium: se.is_premium, disabled_driver: se.disabled_driver,
      entered_at: se.entered_at, left_at: se.now, fee, paid, guard_out_name: req.user.full_name,
      hours: Math.max(1, Math.ceil((se.now - se.entered_at) / 3600000)), tariff,
    };
    broadcast({ type: paid ? 'exit' : 'expel', lot: se.lot, plate: se.plate, label: se.label, fee, guard: req.user.full_name });
    res.json(receipt);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => (broken = true));
    if (/timeout/i.test(e.message)) broken = true;
    throw e;
  } finally {
    db.release(broken);
  }
}

// ---------- 4. GET /api/revenue — bugungi tushum ----------
app.get('/api/revenue', async (req, res) => {
  if (req.user.role === 'guard') throw fail(403, 'Tushum faqat admin va boshliq uchun');
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(se.fee), 0)::int AS total, count(*)::int AS count
    FROM sessions se JOIN spots s ON s.id = se.spot_id
    WHERE se.left_at >= date_trunc('day', now()) AND se.paid AND ($1::int IS NULL OR s.lot = $1)`, [lotOf(req)]);
  res.json(rows[0]);
});

// ---------- Kirish chekini tekshirish (QR skaner) ----------
// Chek raqami yoki mashina raqami. active = mashina hali ichkarida.
app.get('/api/tickets/:code', async (req, res) => {
  const code = String(req.params.code).toUpperCase().replace(/[\s-]/g, '');
  const { rows } = await pool.query(`
    SELECT se.id, se.ticket_no, se.receipt_no, se.plate, se.entered_at, se.left_at, se.fee, se.paid, se.disabled_driver, se.spot_id,
           s.label, s.zone, s.is_premium, s.lot, se.left_at IS NULL AS active, gi.full_name AS guard_in_name
    FROM sessions se JOIN spots s ON s.id = se.spot_id
    LEFT JOIN users gi ON gi.id = se.guard_in
    WHERE replace(se.ticket_no, '-', '') = $1 OR se.plate = $1
    ORDER BY (replace(se.ticket_no, '-', '') = $1) DESC, se.left_at IS NULL DESC, se.entered_at DESC LIMIT 1`, [code]);
  if (!rows[0]) throw fail(404, "Bunday chek topilmadi");
  const lot = lotOf(req);
  if (lot && rows[0].active && rows[0].lot !== lot) throw fail(409, `Bu chek ${rows[0].lot}-stoyankaniki: mashina o'sha darvozadan chiqadi`);
  res.json({ ...rows[0], tariff: await getTariff() });
});

// ---------- Cheklar arxivi ----------
app.get('/api/receipts', async (req, res) => {
  const { q = '', from = null, to = null } = req.query;
  const { rows } = await pool.query(`
    SELECT se.id, se.receipt_no, se.ticket_no, se.plate, se.entered_at, se.left_at, se.fee, se.paid, se.disabled_driver,
           s.label, s.is_premium, s.lot, gi.full_name AS guard_in_name, go.full_name AS guard_out_name
    FROM sessions se
    JOIN spots s ON s.id = se.spot_id
    LEFT JOIN users gi ON gi.id = se.guard_in
    LEFT JOIN users go ON go.id = se.guard_out
    WHERE se.left_at IS NOT NULL
      AND ($1 = '' OR se.plate ILIKE '%' || $1 || '%' OR replace(se.receipt_no, '-', '') ILIKE '%' || $1 || '%'
           OR replace(se.ticket_no, '-', '') ILIKE '%' || $1 || '%')
      AND ($2::date IS NULL OR se.left_at >= $2::date)
      AND ($3::date IS NULL OR se.left_at < $3::date + 1)
      AND ($4::int IS NULL OR s.lot = $4)
    ORDER BY se.left_at DESC LIMIT 300`, [String(q).trim().replace(/[\s-]/g, ''), from || null, to || null, lotOf(req)]);
  res.json(rows);
});

// ---------- Xavfsizlik: qidiruvdagi (o'g'irlangan) raqamlar, smenadagi tekshiruvchilar, topilganlar ----------
app.get('/api/security', async (req, res) => {
  const [wanted, found, inspectors] = await Promise.all([
    pool.query('SELECT plate, note, added_at FROM wanted ORDER BY added_at DESC'),
    pool.query(`SELECT f.id, f.plate, f.spot_label, f.inspector, f.found_at, se.left_at IS NULL AS open
      FROM stolen_found f LEFT JOIN sessions se ON se.id = f.session_id ORDER BY f.found_at DESC LIMIT 200`),
    pool.query("SELECT id, full_name, on_shift FROM staff WHERE role = 'inspector' AND active ORDER BY id"),
  ]);
  res.json({ wanted: wanted.rows, found: found.rows, inspectors: inspectors.rows });
});

// Tekshiruvchi stoyankadagi mashina qidiruvda ekanini aniqladi — bir tashrif uchun bir marta yoziladi, hammaga xabar
app.post('/api/stolen', async (req, res) => {
  const plate = normPlate(req.body?.plate);
  const inspector = String(req.body?.inspector || '').trim().slice(0, 60) || 'Tekshiruvchi';
  const w = await pool.query('SELECT note FROM wanted WHERE plate = $1', [plate]);
  if (!w.rows[0]) throw fail(404, 'Bu raqam qidiruvda emas');
  const se = (await pool.query(
    'SELECT se.id, s.label FROM sessions se JOIN spots s ON s.id = se.spot_id WHERE se.plate = $1 AND se.left_at IS NULL', [plate])).rows[0];
  if (!se) throw fail(404, 'Bu mashina stoyankada emas');
  const { rows } = await pool.query(
    'INSERT INTO stolen_found (plate, spot_label, session_id, inspector) VALUES ($1, $2, $3, $4) ON CONFLICT (session_id) DO NOTHING RETURNING *',
    [plate, se.label, se.id, inspector]);
  if (rows[0]) broadcast({ type: 'stolen', plate, label: se.label, inspector, note: w.rows[0].note, at_found: rows[0].found_at });
  res.status(rows[0] ? 201 : 200).json(rows[0] || { duplicate: true });
});

// ---------- Admin ----------
app.use('/api/admin', adminOnly);
mountBossAdmin(app, pool);

app.get('/api/admin/stats', async (req, res) => {
  const [zones, week, guards, today] = await Promise.all([
    pool.query(`
      SELECT zone, count(*)::int AS total,
             count(*) FILTER (WHERE is_busy)::int AS busy,
             count(*) FILTER (WHERE is_disabled)::int AS disabled
      FROM spots WHERE ($1::int IS NULL OR lot = $1) GROUP BY zone ORDER BY zone`, [lotOf(req)]),
    pool.query(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(SUM(se.fee), 0)::int AS total, count(se.id)::int AS count
      FROM generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d
      LEFT JOIN sessions se ON se.left_at >= d AND se.left_at < d + interval '1 day' AND se.paid
      GROUP BY d ORDER BY d`),
    pool.query(`
      SELECT u.id, u.full_name, u.lot, count(se.id)::int AS exits, COALESCE(SUM(se.fee), 0)::int AS total
      FROM users u
      LEFT JOIN sessions se ON se.guard_out = u.id AND se.left_at >= date_trunc('day', now()) AND se.paid
      WHERE u.role = 'guard' GROUP BY u.id ORDER BY total DESC`),
    pool.query(`
      SELECT COALESCE(SUM(fee) FILTER (WHERE paid), 0)::int AS total, count(*)::int AS count,
             COALESCE(SUM(fee) FILTER (WHERE NOT paid), 0)::int AS unpaid,
             COALESCE(round(avg(extract(epoch FROM left_at - entered_at)) / 60), 0)::int AS avg_minutes
      FROM sessions WHERE left_at >= date_trunc('day', now())`),
  ]);
  res.json({ zones: zones.rows, week: week.rows, guards: guards.rows, today: today.rows[0] });
});

// Joyni premium / ta'mirda qilish
app.put('/api/admin/spots/:id', async (req, res) => {
  const { is_premium = null, is_disabled = null, is_accessible = null } = req.body || {};
  const { rows } = await pool.query(`
    UPDATE spots SET is_premium = COALESCE($2, is_premium), is_disabled = COALESCE($3, is_disabled), is_accessible = COALESCE($4, is_accessible)
    WHERE id = $1 AND NOT (is_busy AND COALESCE($3, false)) RETURNING *`, [req.params.id, is_premium, is_disabled, is_accessible]);
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
  const { rows } = await pool.query('SELECT id, username, full_name, role, active, lot FROM users ORDER BY id');
  res.json(rows);
});

app.post('/api/admin/users', async (req, res) => {
  const { username, password, full_name, role = 'guard', lot = 1 } = req.body || {};
  if (![1, 2].includes(Number(lot))) throw fail(400, "Stoyanka 1 yoki 2 bo'lsin");
  if (!/^[a-z0-9_]{3,20}$/.test(username || '')) throw fail(400, 'Login: 3–20 ta kichik lotin harf yoki raqam');
  if (String(password || '').length < 6) throw fail(400, "Parol kamida 6 belgi bo'lsin");
  if (!String(full_name || '').trim()) throw fail(400, 'Ism kiriting');
  if (!['admin', 'guard'].includes(role)) throw fail(400, "Rol noto'g'ri");
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role, lot) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, full_name, role, active, lot',
      [username, hashPassword(password), full_name.trim(), role, role === 'guard' ? Number(lot) : null]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw fail(409, 'Bu login band');
    throw e;
  }
});

app.put('/api/admin/users/:id', async (req, res) => {
  const { full_name = null, password = null, active = null, lot = null } = req.body || {};
  if (lot !== null && ![1, 2].includes(Number(lot))) throw fail(400, "Stoyanka 1 yoki 2 bo'lsin");
  if (Number(req.params.id) === req.user.id && active === false) throw fail(400, "O'zingizni o'chira olmaysiz");
  if (password !== null && String(password).length < 6) throw fail(400, "Parol kamida 6 belgi bo'lsin");
  const { rows } = await pool.query(`
    UPDATE users SET full_name = COALESCE($2, full_name), password_hash = COALESCE($3, password_hash),
                     active = COALESCE($4, active), lot = COALESCE($5, lot)
    WHERE id = $1 RETURNING id, username, full_name, role, active, lot`,
    [req.params.id, full_name?.trim() || null, password ? hashPassword(password) : null, active, lot === null ? null : Number(lot)]);
  if (!rows[0]) throw fail(404, 'Profil topilmadi');
  res.json(rows[0]);
});

// O'g'irlangan mashina militsiyaga topshirildi: sessiya yopiladi (to'lovsiz), joy bo'shaydi
app.post('/api/admin/stolen/:id/handover', async (req, res) => {
  const { rows } = await pool.query(`
    UPDATE sessions se SET left_at = now(), fee = 0, paid = true, guard_out = $2, receipt_no = 'MT-' || lpad(se.id::text, 6, '0')
    FROM stolen_found f WHERE f.id = $1 AND se.id = f.session_id AND se.left_at IS NULL
    RETURNING se.spot_id, se.plate`, [req.params.id, req.user.id]);
  if (!rows[0]) throw fail(404, 'Mashina allaqachon chiqib ketgan');
  await pool.query('UPDATE spots SET is_busy = false WHERE id = $1', [rows[0].spot_id]);
  broadcast({ type: 'security' });
  res.json({ ok: true });
});

// Qidiruvdagi raqamlar (IIV / sug'urta xabari bo'yicha)
app.post('/api/admin/wanted', async (req, res) => {
  const plate = normPlate(req.body?.plate);
  const note = String(req.body?.note || '').trim().slice(0, 120);
  const { rows } = await pool.query(
    'INSERT INTO wanted (plate, note) VALUES ($1, $2) ON CONFLICT (plate) DO UPDATE SET note = EXCLUDED.note RETURNING *', [plate, note]);
  broadcast({ type: 'security' });
  res.status(201).json(rows[0]);
});
app.delete('/api/admin/wanted/:plate', async (req, res) => {
  await pool.query('DELETE FROM wanted WHERE plate = $1', [normPlate(req.params.plate)]);
  broadcast({ type: 'security' });
  res.json({ deleted: true });
});

// Tekshiruvchilar: yangi ishchi qo'shish va smenaga qo'yish (bir smenada ko'pi bilan 2 ta)
const INSPECTOR_WAGE = 180000;
app.post('/api/admin/inspectors', async (req, res) => {
  const name = String(req.body?.full_name || '').trim();
  if (name.length < 3) throw fail(400, 'Ism va familiyani kiriting');
  const { rows } = await pool.query(
    "INSERT INTO staff (full_name, role, daily_wage) VALUES ($1, 'inspector', $2) RETURNING id, full_name, on_shift", [name.slice(0, 60), INSPECTOR_WAGE]);
  broadcast({ type: 'security' });
  res.status(201).json(rows[0]);
});
app.put('/api/admin/inspectors/:id', async (req, res) => {
  const onShift = req.body?.on_shift === true;
  if (onShift) {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM staff WHERE role = 'inspector' AND active AND on_shift AND id <> $1", [req.params.id]);
    if (rows[0].n >= 2) throw fail(409, 'Smenada allaqachon 2 ta tekshiruvchi bor. Avval birini smenadan chiqaring');
  }
  const { rows } = await pool.query(
    "UPDATE staff SET on_shift = $2 WHERE id = $1 AND role = 'inspector' RETURNING id, full_name, on_shift", [req.params.id, onShift]);
  if (!rows[0]) throw fail(404, 'Tekshiruvchi topilmadi');
  broadcast({ type: 'security' });
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

// Bo'sh baza (yangi bulut bazasi): jadvallar va profillarni o'zi yaratadi
const { rows: [fresh] } = await pool.query("SELECT to_regclass('public.users') IS NULL AS empty");
if (fresh.empty) {
  await seed(pool);
  console.log("Bo'sh baza: jadvallar va profillar yaratildi");
}

// Eski bazani yangilash (ma'lumot o'chmaydi): yangi ustunlar va tarif kalitlari
await pool.query(`
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ticket_no TEXT UNIQUE;
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT true;
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS disabled_driver BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE spots ADD COLUMN IF NOT EXISTS is_accessible BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE spots ADD COLUMN IF NOT EXISTS lot SMALLINT NOT NULL DEFAULT 1;
  ALTER TABLE spots DROP CONSTRAINT IF EXISTS spots_label_key;
  CREATE UNIQUE INDEX IF NOT EXISTS spots_lot_label ON spots(lot, label);
  INSERT INTO spots (label, zone, is_premium, is_accessible, lot)
    SELECT label, zone, is_premium, is_accessible, 2 FROM spots WHERE lot = 1 AND NOT EXISTS (SELECT 1 FROM spots WHERE lot = 2) ORDER BY id;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS lot SMALLINT;
  UPDATE users SET lot = 1 WHERE role = 'guard' AND (lot IS NULL OR lot = 2); -- hozircha bitta stoyanka ishlaydi
  CREATE TABLE IF NOT EXISTS wanted (plate TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', added_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS stolen_found (
    id SERIAL PRIMARY KEY, plate TEXT NOT NULL, spot_label TEXT NOT NULL, session_id INTEGER UNIQUE REFERENCES sessions(id),
    inspector TEXT NOT NULL, found_at TIMESTAMPTZ NOT NULL DEFAULT now());
  INSERT INTO settings VALUES ('premium_hour', 30000) ON CONFLICT (key) DO NOTHING;
  DELETE FROM settings WHERE key = 'premium_mult';`).then(() => migrateBoss(pool)).catch((e) => {
  console.error(`Baza tayyor emas (${e.message}). Avval: npm run init-db`);
  process.exit(1);
});

// Nazoratchi: baza ketma-ket 2 marta javob bermasa — jarayon chiqib ketadi, kuzatuvchi (npm run local / Render) qayta ko'taradi
let dbFails = 0;
setInterval(() => {
  pool.query('SELECT 1').then(() => { dbFails = 0; }, (e) => {
    console.error('Baza javob bermadi:', e.message);
    if (++dbFails >= 2) process.exit(1);
  });
}, 15000).unref();

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AvtoStoyanka server: http://localhost:${port}`));
