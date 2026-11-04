// Premium kirish: orqada tungi stoyanka (qiyalatilgan 3D tekislik, mashinalar joyiga kirib-chiqadi),
// oldinda oltin hoshiyali karta. Login yozilganda o'sha xodimning 3D personaji chiqadi.
// "Kirish" bosilganda tugma ichida mashina kirib keladi; muvaffaqiyatda personaj sakrab xursand bo'ladi.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api, API, setToken } from './api';
import { characterFor } from './characters';
import Icon from './Icon';

const CharacterStage = lazy(() => import('./LoginScene'));
const ButtonCar = lazy(() => import('./LoginScene').then((m) => ({ default: m.ButtonCar })));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Orqa fon: 4 qator × 14 joy; har joyda mashina o'z ritmida kirib-chiqadi, yo'lakda faralar yurib o'tadi
const PAINT = ['#c9ccd1', '#3b4a6b', '#8a2f2f', '#e6e3dc', '#4f5a52', '#1f2226', '#9a7b4f', '#5b6f8a'];
function LotBackdrop() {
  const stalls = useMemo(
    () => Array.from({ length: 56 }, (_, i) => ({
      paint: PAINT[(i * 7) % PAINT.length],
      cycle: 9 + ((i * 13) % 11), // har joyda boshqa ritm
      delay: -((i * 37) % 19),
      empty: i % 5 === 2,
    })),
    []
  );
  return (
    <div className="lot-backdrop" aria-hidden="true">
      <div className="lot-plane">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={`bd-row ${row % 2 ? 'up' : 'down'}`}>
            {stalls.slice(row * 14, row * 14 + 14).map((s, i) => (
              <div key={i} className="bd-stall">
                {!s.empty && <i className="bd-car" style={{ '--paint': s.paint, '--cycle': `${s.cycle}s`, '--delay': `${s.delay}s` }} />}
              </div>
            ))}
            {row % 2 === 0 && <div className="bd-lane"><i className="bd-lights" style={{ '--delay': `${-row * 3}s` }} /></div>}
          </div>
        ))}
      </div>
      <div className="lot-vignette" />
    </div>
  );
}

export default function Login({ onLogin, online: bootOnline }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | driving | done | fail
  const [role, setRole] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [online, setOnline] = useState(bootOnline);
  const character = useMemo(() => characterFor(form.username, role), [form.username, role]);

  // Oflayn bo'lsa — har 5 soniyada va tarmoq qaytganda serverni qayta tekshiramiz
  useEffect(() => {
    if (online) return;
    const check = () => fetch(`${API}/health`, { cache: 'no-store' }).then((r) => r.ok && setOnline(true), () => {});
    const t = setInterval(check, 5000);
    window.addEventListener('online', check);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', check);
    };
  }, [online]);

  async function submit(e) {
    e.preventDefault();
    if (phase === 'driving' || phase === 'done') return;
    setError('');
    setPhase('driving');
    const started = performance.now();
    try {
      const { token, user } = await api('/login', { method: 'POST', body: form });
      await wait(Math.max(0, 1100 - (performance.now() - started))); // mashina tugma ichiga kirib ulgursin
      setToken(token);
      setRole(user.role);
      setPhase('done');
      await wait(1700); // personaj sakrab xursand bo'ladi
      setLeaving(true);
      await wait(650);
      onLogin(user);
    } catch (err) {
      await wait(Math.max(0, 800 - (performance.now() - started)));
      setPhase('fail');
      setError(err.message);
      setTimeout(() => setPhase((p) => (p === 'fail' ? 'idle' : p)), 1800);
    }
  }

  const mode = phase === 'done' ? 'cheer' : phase === 'fail' ? 'sad' : 'idle';
  return (
    <main className={`login premium${leaving ? ' leaving' : ''}`}>
      <LotBackdrop />
      <form className="login-card lux" onSubmit={submit}>
        <div className="lux-head">
          <div className="p-sign" aria-hidden="true">P</div>
          <div>
            <p className="lux-badge"><Icon name="crown" /> Premium</p>
            <h1>AvtoStoyanka</h1>
            <p className="muted">Qo'riqlanadigan premium to'xtash joyi. Smenaga kiring</p>
          </div>
        </div>

        <div className="char-wrap">
          <Suspense fallback={<div className="char-stage" />}>
            <CharacterStage character={character} mode={mode} />
          </Suspense>
          <span className="char-name">{phase === 'done' ? `Xush kelibsiz, ${character.name.split(',')[0]}!` : character.name}</span>
          {phase === 'done' && <span className="confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i }} />)}</span>}
        </div>

        {!online && (
          <p className="boot-offline" role="status">Oflayn: server bilan aloqa yo'q. Ulanish tiklanganda kirish ochiladi.</p>
        )}
        <label>Login
          <input className="input" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" />
        </label>
        <label>Parol
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password" />
        </label>
        <button className={`btn primary big login-btn ${phase}`} disabled={!online || !form.username || !form.password}>
          <Suspense fallback={null}><ButtonCar phase={phase} plate={form.username.toUpperCase() || 'AVTO'} /></Suspense>
          <span className="login-btn-text">
            {phase === 'driving' ? 'Tekshirilmoqda…' : phase === 'done' ? 'Kirdingiz' : 'Kirish'}
          </span>
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
