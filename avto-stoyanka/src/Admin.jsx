// Admin bo'limlari: umumiy holat, joylar, tarif, qorovullar
import { useEffect, useState } from 'react';
import { api, money, calcFee } from './api';

// ---------- Boshliq havolasi: nusxalash, ochish, yangilash (eskisi ishlamay qoladi) ----------
function BossLink() {
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api('/admin/boss-link').then((r) => setKey(r.key), (e) => setMsg(e.message));
  }, []);
  const url = key ? `${window.location.origin}/boshliq?key=${key}` : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setMsg('Havola nusxalandi');
    } catch {
      setMsg("Nusxalab bo'lmadi — havolani qo'lda belgilang");
    }
  };
  const renew = async () => {
    if (!window.confirm("Yangi havola yaratilsinmi? Eski havola ishlamay qoladi.")) return;
    const r = await api('/admin/boss-link', { method: 'POST' });
    setKey(r.key);
    setMsg('Yangi havola yaratildi');
  };
  return (
    <section className="card">
      <h2>Boshliq sahifasi</h2>
      <p className="muted small">Shu havolani boshliqqa yuboring: kunlik, haftalik, oylik tushum, ish haqi va xarajatlar. Login kerak emas.</p>
      <div className="boss-link">
        <code>{url || '…'}</code>
        <button className="btn primary sm" onClick={copy} disabled={!url}>Nusxalash</button>
        <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">Ochish</a>
      </div>
      <button className="btn ghost sm danger-text" onClick={renew} style={{ marginTop: '.6rem' }}>Havolani yangilash</button>
      {msg && <p className="muted" role="status">{msg}</p>}
    </section>
  );
}

// ---------- Umumiy holat ----------
export function Overview({ spots, lastEvent }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/admin/stats').then(setStats, (e) => setError(e.message));
  }, [lastEvent]);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Yuklanmoqda…</p>;

  const inside = spots.filter((s) => s.is_busy).length;
  const open = spots.filter((s) => !s.is_disabled).length;
  const maxDay = Math.max(1, ...stats.week.map((d) => d.total));
  // Brauzerlarda uz-UZ hafta kunlari yo'q — o'zimiz yozamiz
  const dayName = (d) => {
    const date = new Date(d + 'T00:00');
    return `${['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'][date.getDay()]} ${date.getDate()}`;
  };

  return (
    <div className="overview">
      <div className="tiles">
        <div className="tile sign"><span>Bugungi tushum</span><b>{money(stats.today.total)}</b></div>
        <div className="tile"><span>Hozir ichkarida</span><b>{inside} <small>/ {open}</small></b></div>
        <div className="tile"><span>Bugun chiqqan</span><b>{stats.today.count}</b></div>
        <div className="tile"><span>To'lanmagan (qarz)</span><b className="debt">{money(stats.today.unpaid)}</b></div>
        <div className="tile"><span>O'rtacha turish</span><b>{stats.today.avg_minutes} <small>daq</small></b></div>
      </div>

      <BossLink />

      <div className="panels">
        <section className="card">
          <h2>Zonalar bandligi</h2>
          {stats.zones.map((z) => (
            <div className="zone-bar" key={z.zone}>
              <b>{z.zone}</b>
              <div className="bar" role="img" aria-label={`${z.zone}: ${z.busy} band, ${z.disabled} ta'mirda, ${z.total} dan`}>
                <i className="busy" style={{ width: `${(z.busy / z.total) * 100}%` }} />
                <i className="off" style={{ width: `${(z.disabled / z.total) * 100}%` }} />
              </div>
              <span>{z.busy}/{z.total}</span>
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Oxirgi 7 kun</h2>
          <div className="week">
            {stats.week.map((d) => (
              <div className="day" key={d.day} title={`${money(d.total)}, ${d.count} chek`}>
                <span className="day-sum">{d.total ? Math.round(d.total / 1000) + 'k' : ''}</span>
                <i style={{ height: `${(d.total / maxDay) * 100}%` }} />
                <span>{dayName(d.day)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Qorovullar bugun</h2>
          <ol className="leaders">
            {stats.guards.map((g) => (
              <li key={g.id}><span>{g.full_name}</span><span>{g.exits} chek</span><b>{money(g.total)}</b></li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

// ---------- Joylar: premium / ta'mir ----------
export function SpotsAdmin({ spots, reload }) {
  const [zone, setZone] = useState('A');
  const [mode, setMode] = useState('is_disabled');
  const [error, setError] = useState('');

  async function toggle(s) {
    setError('');
    try {
      await api(`/admin/spots/${s.id}`, { method: 'PUT', body: { [mode]: !s[mode] } });
      await reload();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="card">
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Zona">
          {['A', 'B', 'C', 'D', 'E'].map((z) => (
            <button key={z} className={z === zone ? 'on' : ''} onClick={() => setZone(z)}>{z}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Nimani o'zgartirish">
          <button className={mode === 'is_disabled' ? 'on' : ''} onClick={() => setMode('is_disabled')}>Ta'mirga yopish</button>
          <button className={mode === 'is_premium' ? 'on' : ''} onClick={() => setMode('is_premium')}>Premium qilish</button>
          <button className={mode === 'is_accessible' ? 'on' : ''} onClick={() => setMode('is_accessible')}>♿ Nogironlar joyi</button>
        </div>
      </div>
      <p className="muted">Joyni bosing: {mode === 'is_disabled' ? "ta'mirga yopiladi yoki ochiladi" : mode === 'is_premium' ? "premium belgisi qo'yiladi yoki olinadi" : 'nogironlar uchun (bepul) joy qilinadi yoki oddiy joyga qaytariladi'}.</p>
      <div className="chips">
        {spots.filter((s) => s.zone === zone).map((s) => (
          <button
            key={s.id}
            className={`chip${s.is_busy ? ' busy' : ''}${s.is_disabled ? ' off' : ''}${s.is_premium ? ' premium' : ''}${s.is_accessible ? ' acc' : ''}`}
            onClick={() => toggle(s)}
            aria-pressed={s[mode]}
          >
            {s.label}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

// ---------- Tarif ----------
export function TariffAdmin({ tariff, reload }) {
  const [form, setForm] = useState(tariff);
  const [msg, setMsg] = useState('');
  if (!form) return null;

  const set = (k) => (e) => setForm({ ...form, [k]: Number(e.target.value) });
  async function save(e) {
    e.preventDefault();
    try {
      await api('/admin/settings', { method: 'PUT', body: form });
      await reload();
      setMsg('Tarif saqlandi');
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <div className="panels two">
      <form className="card form" onSubmit={save}>
        <h2>Tarif</h2>
        <label>1-soat narxi, so'm<input className="input" type="number" min="0" step="500" value={form.base_hour} onChange={set('base_hour')} /></label>
        <label>Har keyingi soatga qo'shiladi, so'm<input className="input" type="number" min="0" step="500" value={form.step_hour} onChange={set('step_hour')} /></label>
        <label>Premium joy, 1-soat narxi, so'm<input className="input" type="number" min="0" step="1000" value={form.premium_hour} onChange={set('premium_hour')} /></label>
        <button className="btn primary">Tarifni saqlash</button>
        {msg && <p className="muted" role="status">{msg}</p>}
      </form>
      <section className="card">
        <h2>Qancha to'laydi</h2>
        <table className="table">
          <thead><tr><th>Turdi</th><th className="num">Oddiy</th><th className="num">Premium</th></tr></thead>
          <tbody>
            {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => (
              <tr key={h}>
                <td>{h} soat</td>
                <td className="num">{money(calcFee(h * 3600000, form, false))}</td>
                <td className="num gold">{money(calcFee(h * 3600000, form, true))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ---------- Qorovullar ----------
export function UsersAdmin({ me }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'guard' });
  const [msg, setMsg] = useState('');
  const load = () => api('/admin/users').then(setUsers, (e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const run = async (fn, ok) => {
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/admin/users', { method: 'POST', body: form });
      setForm({ username: '', password: '', full_name: '', role: 'guard' });
    }, "Profil qo'shildi");
  };
  const resetPassword = (u) => {
    const password = window.prompt(`${u.full_name} uchun yangi parol (kamida 6 belgi)`);
    if (password) run(() => api(`/admin/users/${u.id}`, { method: 'PUT', body: { password } }), 'Parol yangilandi');
  };
  const remove = (u) => {
    if (window.confirm(`${u.full_name} profilini o'chirasizmi? Cheklari arxivda qoladi.`))
      run(() => api(`/admin/users/${u.id}`, { method: 'DELETE' }), "Profil o'chirildi");
  };

  return (
    <div className="panels two">
      <section className="card">
        <h2>Profillar</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ism</th><th>Login</th><th>Rol</th><th>Holat</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'dim'}>
                  <td>{u.full_name}</td>
                  <td className="mono">{u.username}</td>
                  <td>{u.role === 'admin' ? 'Admin' : 'Qorovul'}</td>
                  <td>
                    <button className="btn ghost sm" disabled={u.id === me.id}
                      onClick={() => run(() => api(`/admin/users/${u.id}`, { method: 'PUT', body: { active: !u.active } }), u.active ? "Profil to'xtatildi" : 'Profil faollashtirildi')}>
                      {u.active ? 'Faol' : "To'xtatilgan"}
                    </button>
                  </td>
                  <td className="row-actions">
                    <button className="btn ghost sm" onClick={() => resetPassword(u)}>Parol</button>
                    {u.id !== me.id && <button className="btn ghost sm danger-text" onClick={() => remove(u)}>O'chirish</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {msg && <p className="muted" role="status">{msg}</p>}
      </section>
      <form className="card form" onSubmit={add}>
        <h2>Yangi qorovul</h2>
        <label>To'liq ism<input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
        <label>Login<input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} required pattern="[a-z0-9_]{3,20}" /></label>
        <label>Parol<input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} /></label>
        <label>Rol
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="guard">Qorovul</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button className="btn primary">Profil qo'shish</button>
      </form>
    </div>
  );
}
