// Boshliq sahifasi: maxfiy havola (kalit) orqali statistika, ish haqi va xarajatlar.
// Hisob: foyda = tushum − ish haqi − xarajatlar.
import crypto from 'node:crypto';

const DAYS = { day: 1, week: 7, month: 30 };
const WAGE = { guard: 200000, washer: 150000 }; // kunlik ish haqi, so'm
const WASHERS = ['Sardor', 'Jasur', 'Otabek'];
const EXPENSES = [
  ["Yer ijarasi", 6000000, 'month'],
  ["Elektr energiya", 1500000, 'month'],
  ["Suv", 300000, 'month'],
  ["Internet va kameralar xizmati", 400000, 'month'],
  ["Ta'mirlash fondi", 1000000, 'month'],
  ["Moyka vositalari", 50000, 'day'],
  ["Soliq (tushumdan)", 4, 'percent'],
];

// Jadvallar va boshlang'ich ma'lumotlar (bor bo'lsa — tegmaydi)
export async function migrateBoss(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('guard', 'washer')),
      daily_wage INTEGER NOT NULL,
      pay_period TEXT NOT NULL DEFAULT 'month' CHECK (pay_period IN ('day', 'week', 'month')),
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      active BOOLEAN NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 0),
      period TEXT NOT NULL CHECK (period IN ('day', 'month', 'percent'))
    );`);
  await pool.query('INSERT INTO kv VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', ['boss_key', crypto.randomBytes(18).toString('base64url')]);
  // Nogironlar joylari: har oddiy zonaning kirishga eng yaqin 2 joyi (bir marta; keyin admin o'zgartiradi)
  const seeded = await pool.query("INSERT INTO kv VALUES ('accessible_seeded', '1') ON CONFLICT (key) DO NOTHING RETURNING key");
  if (seeded.rows[0]) await pool.query("UPDATE spots SET is_accessible = true WHERE NOT is_premium AND right(label, 2) IN ('01', '02')");
  // Har bir qorovul profili — xodim; moykachilar bir marta qo'shiladi
  await pool.query(`
    INSERT INTO staff (full_name, role, daily_wage, user_id)
    SELECT full_name, 'guard', $1, id FROM users WHERE role = 'guard' AND id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)`, [WAGE.guard]);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM staff WHERE role = 'washer'");
  if (!rows[0].n) {
    for (const [i, name] of WASHERS.entries()) {
      await pool.query("INSERT INTO staff (full_name, role, daily_wage, pay_period) VALUES ($1, 'washer', $2, $3)", [name, WAGE.washer, ['day', 'week', 'month'][i]]);
    }
  }
  const ex = await pool.query('SELECT count(*)::int AS n FROM expenses');
  if (!ex.rows[0].n) {
    for (const [name, amount, period] of EXPENSES) await pool.query('INSERT INTO expenses (name, amount, period) VALUES ($1, $2, $3)', [name, amount, period]);
  }
}

// Xarajatning davr uchun summasi
export function expenseFor(e, days, revenue) {
  if (e.period === 'percent') return Math.round((revenue * e.amount) / 100);
  return e.period === 'day' ? e.amount * days : Math.round((e.amount * days) / 30);
}

// Keyingi to'lov sanasi: kunlik — ertaga, haftalik — dushanba, oylik — keyingi oyning 1-kuni
export function nextPayout(period, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'day') d.setDate(d.getDate() + 1);
  else if (period === 'week') d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  else d.setMonth(d.getMonth() + 1, 1);
  // mahalliy sana (toISOString UTC ga o'tkazib, bir kun oldin ko'rsatardi)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mountBoss(app, pool, fail) {
  // Kalit tekshiruvi (vaqtga chidamli taqqoslash)
  const bossOnly = async (req, res, next) => {
    const key = String(req.query.key || req.headers['x-boss-key'] || '');
    const { rows } = await pool.query("SELECT value FROM kv WHERE key = 'boss_key'");
    const real = rows[0]?.value || '';
    const ok = key.length === real.length && real && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(real));
    next(ok ? undefined : fail(403, "Havola noto'g'ri yoki eskirgan"));
  };
  app.use('/api/boss', bossOnly);

  app.get('/api/boss', async (req, res) => {
    const period = DAYS[req.query.period] ? req.query.period : 'day';
    const days = DAYS[period];
    const startSql = "date_trunc('day', now()) - ($1::int - 1) * interval '1 day'";
    const step = period === 'day' ? '1 hour' : '1 day';
    const buckets = period === 'day' ? 24 : days;

    const [totals, series, staff, expenses, guards] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT count(*) FROM sessions WHERE entered_at >= ${startSql})::int AS entered,
          (SELECT count(*) FROM sessions WHERE left_at >= ${startSql})::int AS exited,
          (SELECT COALESCE(SUM(fee), 0) FROM sessions WHERE paid AND left_at >= ${startSql})::bigint AS revenue,
          (SELECT COALESCE(SUM(fee), 0) FROM sessions WHERE paid AND left_at >= ${startSql}
             AND spot_id IN (SELECT id FROM spots WHERE is_premium))::bigint AS premium_revenue,
          (SELECT COALESCE(SUM(fee), 0) FROM sessions WHERE NOT paid AND left_at >= ${startSql})::bigint AS unpaid,
          (SELECT COALESCE(round(avg(extract(epoch FROM left_at - entered_at)) / 60), 0)
             FROM sessions WHERE left_at >= ${startSql})::int AS avg_minutes,
          (SELECT count(*) FROM sessions WHERE left_at IS NULL)::int AS inside,
          (SELECT count(*) FROM sessions WHERE disabled_driver AND entered_at >= ${startSql})::int AS disabled_free`, [days]),
      pool.query(`
        SELECT to_char(b, $2) AS label,
               (SELECT count(*) FROM sessions WHERE entered_at >= b AND entered_at < b + $3::interval)::int AS cars,
               (SELECT COALESCE(SUM(fee), 0) FROM sessions WHERE paid AND left_at >= b AND left_at < b + $3::interval)::bigint AS revenue
        FROM generate_series(${startSql}, ${startSql} + ($4::int - 1) * $3::interval, $3::interval) b
        ORDER BY b`, [days, period === 'day' ? 'HH24' : 'DD.MM', step, buckets]),
      pool.query('SELECT id, full_name, role, daily_wage, pay_period FROM staff WHERE active ORDER BY role, id'),
      pool.query('SELECT id, name, amount, period FROM expenses ORDER BY period, id'),
      pool.query(`
        SELECT u.full_name, count(se.id)::int AS exits, COALESCE(SUM(se.fee) FILTER (WHERE se.paid), 0)::bigint AS revenue
        FROM users u LEFT JOIN sessions se ON se.guard_out = u.id AND se.left_at >= ${startSql}
        WHERE u.role = 'guard' AND u.active GROUP BY u.id ORDER BY revenue DESC`, [days]),
    ]);

    const t = totals.rows[0];
    const revenue = Number(t.revenue);
    const workers = staff.rows.map((s) => ({
      ...s,
      day: s.daily_wage,
      week: s.daily_wage * 7,
      month: s.daily_wage * 30,
      earned: s.daily_wage * days, // shu davr uchun ishlab topgani
      payout: s.daily_wage * DAYS[s.pay_period], // tanlagan muddatida qo'liga oladigani
      next_payout: nextPayout(s.pay_period),
    }));
    const wages = workers.reduce((sum, w) => sum + w.earned, 0);
    const costList = expenses.rows.map((e) => ({ ...e, total: expenseFor(e, days, revenue) }));
    const costs = costList.reduce((sum, e) => sum + e.total, 0);

    res.json({
      period, days,
      totals: { ...t, revenue, premium_revenue: Number(t.premium_revenue), unpaid: Number(t.unpaid) },
      money: { revenue, wages, costs, profit: revenue - wages - costs },
      series: series.rows.map((r) => ({ ...r, revenue: Number(r.revenue) })),
      workers, expenses: costList,
      guards: guards.rows.map((g) => ({ ...g, revenue: Number(g.revenue) })),
    });
  });

  // Ishchi qaysi muddatda olishni xohlasa — shuni belgilaymiz
  app.put('/api/boss/staff/:id', async (req, res) => {
    const { pay_period: p, daily_wage: w } = req.body || {};
    if (p !== undefined && !DAYS[p]) throw fail(400, "Muddat: kunlik, haftalik yoki oylik");
    if (w !== undefined && (!Number.isInteger(w) || w < 0 || w > 100_000_000)) throw fail(400, "Ish haqi musbat butun son bo'lsin");
    const { rows } = await pool.query(
      'UPDATE staff SET pay_period = COALESCE($2, pay_period), daily_wage = COALESCE($3, daily_wage) WHERE id = $1 RETURNING *',
      [req.params.id, p ?? null, w ?? null]);
    if (!rows[0]) throw fail(404, 'Xodim topilmadi');
    res.json(rows[0]);
  });

  const checkExpense = (b = {}) => {
    const name = String(b.name || '').trim();
    const amount = Number(b.amount);
    if (!name) throw fail(400, 'Xarajat nomini yozing');
    if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000_000) throw fail(400, "Summa musbat butun son bo'lsin");
    if (!['day', 'month', 'percent'].includes(b.period)) throw fail(400, "Davr: kunlik, oylik yoki foiz");
    if (b.period === 'percent' && amount > 100) throw fail(400, "Foiz 100 dan oshmasin");
    return [name, amount, b.period];
  };
  app.post('/api/boss/expenses', async (req, res) => {
    const { rows } = await pool.query('INSERT INTO expenses (name, amount, period) VALUES ($1, $2, $3) RETURNING *', checkExpense(req.body));
    res.status(201).json(rows[0]);
  });
  app.put('/api/boss/expenses/:id', async (req, res) => {
    const { rows } = await pool.query('UPDATE expenses SET name = $2, amount = $3, period = $4 WHERE id = $1 RETURNING *', [req.params.id, ...checkExpense(req.body)]);
    if (!rows[0]) throw fail(404, 'Xarajat topilmadi');
    res.json(rows[0]);
  });
  app.delete('/api/boss/expenses/:id', async (req, res) => {
    await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  });
}

// Admin: boshliq havolasi kaliti va uni yangilash (eski havola ishlamay qoladi)
export function mountBossAdmin(app, pool) {
  app.get('/api/admin/boss-link', async (req, res) => {
    const { rows } = await pool.query("SELECT value FROM kv WHERE key = 'boss_key'");
    res.json({ key: rows[0]?.value });
  });
  app.post('/api/admin/boss-link', async (req, res) => {
    const key = crypto.randomBytes(18).toString('base64url');
    await pool.query("UPDATE kv SET value = $1 WHERE key = 'boss_key'", [key]);
    res.json({ key });
  });
}
