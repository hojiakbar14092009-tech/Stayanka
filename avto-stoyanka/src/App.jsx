// Ilova qobig'i: kirish, tepa panel, bo'limlar, real vaqt xabarlari (SSE)
import { useCallback, useEffect, useState } from 'react';
import { api, API, getToken, money } from './api';
import GuardPanel from './GuardPanel';
import Archive from './Archive';
import { Overview, SpotsAdmin, TariffAdmin, UsersAdmin } from './Admin';

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      const { token, user } = await api('/login', { method: 'POST', body: form });
      localStorage.setItem('token', token);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="p-sign" aria-hidden="true">P</div>
        <h1>AvtoStoyanka</h1>
        <p className="muted">Smenaga kiring</p>
        <label>Login<input className="input" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" /></label>
        <label>Parol<input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" /></label>
        <button className="btn primary big">Kirish</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}

const TABS = {
  admin: [['overview', 'Umumiy'], ['lot', 'Stoyanka'], ['archive', 'Cheklar'], ['spots', 'Joylar'], ['tariff', 'Tarif'], ['users', 'Qorovullar']],
  guard: [['lot', 'Stoyanka'], ['archive', 'Cheklar']],
};

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const [tab, setTab] = useState('lot');
  const [spots, setSpots] = useState([]);
  const [revenue, setRevenue] = useState({ total: 0, count: 0 });
  const [tariff, setTariff] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);
  const [toasts, setToasts] = useState([]);

  const signIn = (u) => {
    setUser(u);
    setTab(u.role === 'admin' ? 'overview' : 'lot');
  };

  const notify = useCallback((text, kind = 'warn') => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  // Sahifa ochilganda: spots, tushum va tarif
  const reload = useCallback(async () => {
    const [s, r, t] = await Promise.all([api('/spots'), api('/revenue'), api('/tariff')]);
    setSpots(s);
    setRevenue(r);
    setTariff(t);
  }, []);

  // Saqlangan token bilan avtomatik kirish
  useEffect(() => {
    if (!getToken()) return;
    api('/me').then(signIn, () => {}).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('logout', out);
    return () => window.removeEventListener('logout', out);
  }, []);

  // Kirgandan keyin: ma'lumot + real vaqt xabarlari
  useEffect(() => {
    if (!user) return;
    reload().catch((e) => notify(e.message));
    const es = new EventSource(`${API}/events?token=${encodeURIComponent(getToken())}`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      reload().catch(() => {});
      if (ev.type === 'enter') {
        setLastEvent(ev);
        notify(`${ev.plate} ${ev.label} joyini band qildi${ev.is_premium ? ' (Premium)' : ''}. Qorovul: ${ev.guard}`, 'enter');
      } else if (ev.type === 'exit') {
        setLastEvent(ev);
        notify(`${ev.plate} ${ev.label} joyidan chiqdi, ${money(ev.fee)}. Qorovul: ${ev.guard}`, 'exit');
      } else if (ev.type === 'tariff') {
        notify('Tarif yangilandi', 'info');
      }
    };
    return () => es.close();
  }, [user, reload, notify]);

  if (checking) return null;
  if (!user) return <Login onLogin={signIn} />;

  const free = spots.filter((s) => !s.is_busy && !s.is_disabled).length;
  const taken = spots.filter((s) => s.is_busy).length;

  function logout() {
    localStorage.removeItem('token');
    setUser(null);
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="p-sign sm" aria-hidden="true">P</span>
          <span>AvtoStoyanka</span>
        </div>
        <div className="counters" aria-live="polite">
          <span className="counter free"><b>{free}</b> bo'sh</span>
          <span className="counter busy"><b>{taken}</b> band</span>
          <span className="counter cash"><small>Bugun</small><b>{money(revenue.total)}</b></span>
        </div>
        <div className="who">
          <span>{user.full_name}</span>
          <button className="btn ghost sm" onClick={logout}>Smenani yopish</button>
        </div>
        <nav className="tabs">
          {TABS[user.role].map(([key, label]) => (
            <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}>{label}</button>
          ))}
        </nav>
      </header>

      <main className="content">
        {tab === 'lot' && <GuardPanel spots={spots} tariff={tariff} reload={reload} lastEvent={lastEvent} notify={notify} />}
        {tab === 'archive' && <Archive />}
        {tab === 'overview' && <Overview spots={spots} lastEvent={lastEvent} />}
        {tab === 'spots' && <SpotsAdmin spots={spots} reload={reload} />}
        {tab === 'tariff' && <TariffAdmin key={JSON.stringify(tariff)} tariff={tariff} reload={reload} />}
        {tab === 'users' && <UsersAdmin me={user} />}
      </main>

      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
