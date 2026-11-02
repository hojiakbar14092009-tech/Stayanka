// Boshliq sahifasi: maxfiy havola (/boshliq?key=...) orqali ochiladi, login kerak emas.
// Tushum, ish haqi, xarajatlar va foyda — kunlik, haftalik, oylik; hammasi animatsiya bilan.
import { useCallback, useEffect, useRef, useState } from 'react';
import { API, money } from './api';
import Icon from './Icon';

const KEY = new URLSearchParams(window.location.search).get('key') || '';
const PERIODS = [['day', 'Bugun'], ['week', 'Hafta'], ['month', 'Oy']];
const PAY = [['day', 'Kunlik'], ['week', 'Haftalik'], ['month', 'Oylik']];
const EXP_PERIOD = { day: 'kuniga', month: 'oyiga', percent: '% tushumdan' };
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function bossApi(path, { method = 'GET', body } = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${API}/boss${path}${sep}key=${encodeURIComponent(KEY)}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Server bilan aloqa yo'q");
  return data;
}

// Raqam 0 dan (yoki oldingi qiymatdan) yangisigacha sanab chiqadi
function useCountUp(target, ms = 1100) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) {
      from.current = target;
      setV(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf;
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const val = a + (target - a) * (1 - (1 - p) ** 3);
      setV(val);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Count({ value, format = (n) => Math.round(n).toLocaleString('ru-RU') }) {
  return <>{format(useCountUp(value))}</>;
}

// Ustunli grafik: ustunlar navbat bilan o'sib chiqadi
function Bars({ series }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const max = Math.max(1, ...series.map((s) => s.revenue));
  const maxCars = Math.max(1, ...series.map((s) => s.cars));
  return (
    <div className="bars" role="img" aria-label="Davr bo'yicha tushum va mashinalar">
      {series.map((s, i) => (
        <div className="bar-col" key={s.label} title={`${s.label}: ${money(s.revenue)}, ${s.cars} mashina`}>
          <i className="bar-rev" style={{ height: grown ? `${(s.revenue / max) * 100}%` : 0, transitionDelay: `${i * 25}ms` }} />
          <i className="bar-cars" style={{ bottom: grown ? `${(s.cars / maxCars) * 100}%` : 0, transitionDelay: `${i * 25 + 150}ms` }} />
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// Halqa: tushum qayerga ketadi — ish haqi, xarajatlar, foyda
function Donut({ money: m }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 60);
    return () => clearTimeout(t);
  }, []);
  const parts = [
    ['Ish haqi', m.wages, '#2257d6'],
    ['Xarajatlar', m.costs, '#e5484d'],
    [m.profit >= 0 ? 'Foyda' : 'Zarar', Math.abs(m.profit), m.profit >= 0 ? '#2fb679' : '#8a1c20'],
  ];
  const sum = Math.max(1, parts.reduce((a, p) => a + p[1], 0));
  const C = 2 * Math.PI * 52;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Tushum taqsimoti">
        <circle cx="70" cy="70" r="52" fill="none" stroke="#3a3e44" strokeWidth="18" />
        {parts.map(([name, val, color], i) => {
          const len = (val / sum) * C;
          const el = (
            <circle key={name} cx="70" cy="70" r="52" fill="none" stroke={color} strokeWidth="18"
              strokeDasharray={`${drawn ? len : 0} ${C}`} strokeDashoffset={-offset}
              style={{ transitionDelay: `${i * 250}ms` }} transform="rotate(-90 70 70)" />
          );
          offset += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" className="donut-big">{Math.round((Math.max(0, m.profit) / Math.max(1, m.revenue)) * 100)}%</text>
        <text x="70" y="84" textAnchor="middle" className="donut-small">foyda ulushi</text>
      </svg>
      <ul className="legend-list">
        {parts.map(([name, val, color]) => (
          <li key={name}><i style={{ background: color }} />{name}<b><Count value={val} format={money} /></b></li>
        ))}
      </ul>
    </div>
  );
}

function Expenses({ list, onChange, setError }) {
  const [form, setForm] = useState({ name: '', amount: '', period: 'month' });
  const run = async (fn) => {
    try {
      await fn();
      setError('');
      await onChange();
    } catch (e) {
      setError(e.message);
    }
  };
  const save = (e, patch) => run(() => bossApi(`/expenses/${e.id}`, { method: 'PUT', body: { ...e, ...patch } }));
  const add = (ev) => {
    ev.preventDefault();
    run(async () => {
      await bossApi('/expenses', { method: 'POST', body: { ...form, amount: Number(form.amount) } });
      setForm({ name: '', amount: '', period: 'month' });
    });
  };
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Xarajat</th><th className="num">Miqdor</th><th>Davr</th><th className="num">Shu davrda</th><th /></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={`${e.id}-${e.amount}`}>
                <td>{e.name}</td>
                <td className="num">
                  <input className="input cell" type="number" min="0" defaultValue={e.amount} aria-label={`${e.name} miqdori`}
                    onBlur={(ev) => Number(ev.target.value) !== e.amount && save(e, { amount: Number(ev.target.value) })} />
                </td>
                <td className="muted">{EXP_PERIOD[e.period]}</td>
                <td className="num"><Count value={e.total} format={money} /></td>
                <td><button className="btn ghost sm danger-text" onClick={() => run(() => bossApi(`/expenses/${e.id}`, { method: 'DELETE' }))} aria-label={`${e.name} xarajatini o'chirish`}><Icon name="close" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="exp-add" onSubmit={add}>
        <input className="input" placeholder="Yangi xarajat nomi" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="input" type="number" min="0" placeholder="Summa" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        <select className="input" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
          <option value="month">oyiga</option>
          <option value="day">kuniga</option>
          <option value="percent">% tushumdan</option>
        </select>
        <button className="btn primary">Qo'shish</button>
      </form>
    </>
  );
}

export default function BossPage() {
  const [period, setPeriod] = useState('day');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => bossApi(`?period=${period}`).then(setData, (e) => setError(e.message)), [period]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // jonli: har 30 soniyada yangilanadi
    return () => clearInterval(t);
  }, [load]);

  async function setPay(w, pay_period) {
    try {
      await bossApi(`/staff/${w.id}`, { method: 'PUT', body: { pay_period } });
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!KEY) return <main className="boss empty-key"><p className="error">Havolada kalit yo'q. Admin bergan to'liq havolani oching.</p></main>;
  if (!data) return <main className="boss empty-key">{error ? <p className="error">{error}</p> : <p className="muted">Yuklanmoqda…</p>}</main>;

  const { totals: t, money: m } = data;
  const periodName = PERIODS.find((p) => p[0] === period)[1].toLowerCase();
  const premiumShare = t.revenue ? Math.round((t.premium_revenue / t.revenue) * 100) : 0;

  return (
    <main className="boss" key={period}>
      <header className="boss-top">
        <div className="brand"><span className="p-sign sm" aria-hidden="true">P</span><span>AvtoStoyanka</span><small>Boshliq hisoboti</small></div>
        <div className="seg" role="group" aria-label="Davr">
          {PERIODS.map(([k, label]) => (
            <button key={k} className={k === period ? 'on' : ''} onClick={() => setPeriod(k)} aria-pressed={k === period}>{label}</button>
          ))}
        </div>
        <span className="live"><i /> Jonli, har 30 soniyada</span>
      </header>
      {error && <p className="error" role="alert">{error}</p>}

      <section className={`boss-hero ${m.profit >= 0 ? 'up' : 'down'}`}>
        <p>{m.profit >= 0 ? 'Sizning sof foydangiz' : 'Zarar'}, {periodName}</p>
        <b><Count value={m.profit} format={money} /></b>
        <div className="equation">
          <span className="chip in"><Icon name="ticket" /> Tushum <Count value={m.revenue} format={money} /></span>
          <span className="op">−</span>
          <span className="chip wage"><Icon name="crown" /> Ish haqi <Count value={m.wages} format={money} /></span>
          <span className="op">−</span>
          <span className="chip cost"><Icon name="warning" /> Xarajatlar <Count value={m.costs} format={money} /></span>
        </div>
      </section>

      <div className="tiles boss-tiles">
        <div className="tile"><span><Icon name="car" /> Kirgan mashinalar</span><b><Count value={t.entered} /></b></div>
        <div className="tile"><span><Icon name="exit" /> Chiqqan</span><b><Count value={t.exited} /></b></div>
        <div className="tile"><span><Icon name="pin" /> Hozir ichkarida</span><b><Count value={t.inside} /></b></div>
        <div className="tile"><span><Icon name="crown" /> Premium ulushi</span><b><Count value={premiumShare} />%</b></div>
        <div className="tile"><span><Icon name="drop" /> O'rtacha turish</span><b><Count value={t.avg_minutes} /> <small>daq</small></b></div>
        <div className="tile"><span><Icon name="wheelchair" /> Nogironlar (bepul)</span><b><Count value={t.disabled_free} /></b></div>
        <div className="tile"><span><Icon name="warning" /> To'lanmagan qarz</span><b className="debt"><Count value={t.unpaid} format={money} /></b></div>
      </div>

      <div className="panels two">
        <section className="card">
          <h2>{period === 'day' ? 'Bugun soatma-soat' : period === 'week' ? 'Oxirgi 7 kun' : 'Oxirgi 30 kun'}</h2>
          <Bars series={data.series} />
          <p className="legend"><span className="key gold" /> tushum <span className="key dot" /> kirgan mashinalar</p>
        </section>
        <section className="card">
          <h2>Tushum qayerga ketadi</h2>
          <Donut money={m} />
        </section>
      </div>

      <section className="card">
        <h2>Ishchilar ish haqi</h2>
        <p className="muted small">Qorovul kuniga 200 000, moykachi 150 000 so'm. Har bir ishchi pulni qachon olishni o'zi tanlaydi: kunlik, haftalik yoki oylik.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Ishchi</th><th>Lavozim</th><th className="num">Kunlik</th><th className="num">Haftalik</th><th className="num">Oylik</th><th>Olish muddati</th><th className="num">Qo'liga</th><th>Keyingi to'lov</th></tr>
            </thead>
            <tbody>
              {data.workers.map((w) => (
                <tr key={w.id}>
                  <td>{w.full_name}</td>
                  <td>{w.role === 'guard' ? 'Qorovul' : 'Moykachi'}</td>
                  <td className="num">{money(w.day)}</td>
                  <td className="num">{money(w.week)}</td>
                  <td className="num">{money(w.month)}</td>
                  <td>
                    <div className="seg mini" role="group" aria-label={`${w.full_name} olish muddati`}>
                      {PAY.map(([k, label]) => (
                        <button key={k} className={w.pay_period === k ? 'on' : ''} onClick={() => setPay(w, k)} aria-pressed={w.pay_period === k}>{label}</button>
                      ))}
                    </div>
                  </td>
                  <td className="num gold"><Count value={w.payout} format={money} /></td>
                  <td>{new Date(w.next_payout + 'T00:00').toLocaleDateString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={6}>Shu davrda jami ish haqi ({data.days} kun)</td><td className="num gold" colSpan={2}><Count value={m.wages} format={money} /></td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="panels two">
        <section className="card">
          <h2>Stoyanka xarajatlari</h2>
          <p className="muted small">Summani o'zgartirib, maydondan chiqing — saqlanadi.</p>
          <Expenses list={data.expenses} onChange={load} setError={setError} />
        </section>
        <section className="card">
          <h2>Qorovullar bo'yicha tushum</h2>
          <ol className="leaders">
            {data.guards.map((g) => (
              <li key={g.full_name}><span>{g.full_name}</span><span>{g.exits} chek</span><b><Count value={g.revenue} format={money} /></b></li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
