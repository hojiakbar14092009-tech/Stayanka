// Ilova qobig'i: kirish, tepa panel, bo'limlar, real vaqt xabarlari (SSE)
import { useCallback, useEffect, useState } from 'react';
import { api, API, getToken, clearToken, setActiveLot, money, time } from './api';
import GuardPanel from './GuardPanel';
import Archive from './Archive';
import { Overview, SpotsAdmin, TariffAdmin, UsersAdmin } from './Admin';
import Boot from './Boot';
import Login from './Login';
import Security from './Security';

// Tepa panel foni: Novikov restorani fasadi — kamar derazalar, eshik, soyabon, fonarlar; peshtoqda NOVIKOV,
// ikkinchi "O" — rul g'ildiragi (stoyanka va restoran bitta belgida)
function NovikovFacade() {
  const arches = [0, 1, 2, 4, 5, 6].map((k) => 64 + k * 76);
  return (
    <div className="top-art" aria-hidden="true">
      <svg className="facade" viewBox="0 0 640 120" preserveAspectRatio="xMaxYMax meet">
        <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
          <path d="M14 119 H626" />
          <path d="M40 119 V44 H600 V119" />
          <path d="M30 44 H610 M34 38 H606 M30 44 L34 38 M610 44 L606 38" />
          <path d="M48 38 V26 H592 V38" />
          {Array.from({ length: 28 }, (_, k) => <path key={k} d={'M' + (58 + k * 19.5) + ' 38 V28'} />)}
          {arches.map((x) => (
            <g key={x}>
              <path className="lit" d={'M' + x + ' 119 V84 a17 17 0 0 1 34 0 V119 Z'} />
              <path d={'M' + (x + 17) + ' 67 V119 M' + x + ' 96 H' + (x + 34)} />
            </g>
          ))}
          <path className="lit" d="M290 119 V80 a30 30 0 0 1 60 0 V119 Z" />
          <path d="M320 50 V119" />
          <path d="M276 76 H364 l-6 8 q-6 6 -11 0 q-6 6 -11 0 q-6 6 -11 0 q-6 6 -11 0 q-6 6 -11 0 q-6 6 -11 0 q-6 6 -11 0 Z" />
          {[262, 378].map((x) => <path key={x} className="lamp" d={'M' + x + ' 64 v6 m-4 0 h8 l-1 10 h-6 Z'} />)}
        </g>
        <g className="sign">
          <text x="210" y="62" textLength="220" lengthAdjust="spacing">NOVIK</text>
          <g transform="translate(441 56)" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle r="7.6" />
            <circle r="2" />
            <path d="M0 -2 V-7.6 M1.7 1 L6.6 3.8 M-1.7 1 L-6.6 3.8" />
          </g>
          <text x="451" y="62">V</text>
          <text className="sub" x="320" y="74" textAnchor="middle">restaurant · parking</text>
        </g>
      </svg>
    </div>
  );
}

// LED raqam: o'zgarganda eskisi yuqoriga so'nadi, yangisi pastdan chiqadi (0,45 s, xotirjam)
function LedNumber({ value }) {
  const [shown, setShown] = useState(value);
  const [old, setOld] = useState(null);
  if (shown !== value) {
    setOld(shown);
    setShown(value);
  }
  return (
    <b className="led-num">
      <span key={value} className="led-new">{value}</span>
      {old !== null && <span key={'o' + old} className="led-old" onAnimationEnd={() => setOld(null)} aria-hidden="true">{old}</span>}
    </b>
  );
}

const TABS = {
  admin: [['overview', 'Umumiy'], ['lot', 'Stoyanka'], ['archive', 'Cheklar'], ['security', 'Xavfsizlik'], ['spots', 'Joylar'], ['tariff', 'Tarif'], ['users', 'Qorovullar']],
  guard: [['lot', 'Stoyanka'], ['archive', 'Cheklar'], ['security', "O'g'irlanganlar"]],
};

export default function App() {
  const [user, setUser] = useState(null);
  const [boot, setBoot] = useState(null); // yuklanish natijasi: { online, user }
  const [tab, setTab] = useState('lot');
  const [spots, setSpots] = useState([]);
  const [revenue, setRevenue] = useState({ total: 0, count: 0 });
  const [tariff, setTariff] = useState(null);
  const [lastEvent, setLastEvent] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [security, setSecurity] = useState({ wanted: [], found: [] });
  const [stolenAlert, setStolenAlert] = useState(null); // tekshiruvchi o'g'irlangan mashinani topdi
  const [lot, setLot] = useState(1); // qorovul — o'z stoyankasi; admin almashtiradi
  const chooseLot = (n) => {
    setActiveLot(n);
    setLot(n);
  };

  const signIn = (u) => {
    chooseLot(u.lot || 1);
    setUser(u);
    setTab(u.role === 'admin' ? 'overview' : 'lot');
  };

  const notify = useCallback((text, kind = 'warn') => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  // Sahifa ochilganda: spots, tarif va (faqat adminga) bugungi tushum — qorovul pul statistikasini ko'rmaydi
  const isAdmin = user?.role === 'admin';
  const reload = useCallback(async () => {
    const [s, r, t, sec] = await Promise.all([api('/spots'), isAdmin ? api('/revenue') : null, api('/tariff'), api('/security')]);
    setSpots(s);
    if (r) setRevenue(r);
    setTariff(t);
    setSecurity(sec);
  }, [isAdmin]);

  // Yuklanish tugadi: saqlangan sessiya bo'lsa — to'g'ridan-to'g'ri panelga
  const ready = useCallback((ctx) => {
    setBoot(ctx);
    if (ctx.user) signIn(ctx.user);
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
      if (ev.lot && ev.lot !== lot) return; // boshqa stoyankaning voqeasi
      if (ev.type === 'enter') {
        setLastEvent(ev);
        notify(`${ev.plate} → ${ev.label}${ev.is_premium ? ' (Premium)' : ''}${ev.disabled_driver ? ' ♿ bepul' : ''}${ev.debt ? `. Qarzi bor: ${money(ev.debt)}` : ''}`, ev.debt ? 'expel' : 'enter');
      } else if (ev.type === 'exit') {
        setLastEvent(ev);
        notify(`${ev.plate} ${ev.label} joyidan chiqdi, ${money(ev.fee)}`, 'exit');
      } else if (ev.type === 'expel') {
        setLastEvent(ev);
        notify(`${ev.plate} to'lamadi va haydab chiqarildi. Qarz: ${money(ev.fee)}`, 'expel');
      } else if (ev.type === 'stolen') {
        setStolenAlert(ev);
        notify(`O'g'irlangan mashina: ${ev.plate}, ${ev.label}. Aniqladi: ${ev.inspector}`, 'expel');
      } else if (ev.type === 'tariff') {
        notify('Tarif yangilandi', 'info');
      }
    };
    return () => es.close();
  }, [user, lot, reload, notify]);

  if (!boot) return <Boot onReady={ready} />;
  if (!user) return <Login onLogin={signIn} online={boot.online} />;

  const free = spots.filter((s) => !s.is_busy && !s.is_disabled).length;
  const taken = spots.filter((s) => s.is_busy).length;

  function logout() {
    clearToken();
    setUser(null);
  }

  return (
    <div className="app">
      <header className="top">
        <NovikovFacade />
        <div className="brand">
          <span className="p-sign sm" aria-hidden="true">P</span>
          <span>AvtoStoyanka</span>
        </div>
        {/* Stoyanka kirishidagi LED tablo kabi: qora panel, yonib turgan raqamlar */}
        <div className="counters board" aria-live="polite">
          <span className="cell free"><LedNumber value={free} /><small>bo'sh joy</small></span>
          <span className="cell busy"><LedNumber value={taken} /><small>band</small></span>
          {isAdmin && <span className="cell cash"><b>{money(revenue.total).replace(" so'm", '')}</b><small>bugun, so'm</small></span>}
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
        {tab === 'lot' && <GuardPanel security={security} spots={spots} tariff={tariff} reload={reload} lastEvent={lastEvent} notify={notify} />}
        {tab === 'archive' && <Archive key={lot} showTotal={isAdmin} />}
        {tab === 'security' && <Security security={security} reload={reload} admin={isAdmin} />}
        {tab === 'overview' && <Overview key={lot} spots={spots} lastEvent={lastEvent} />}
        {tab === 'spots' && <SpotsAdmin spots={spots} reload={reload} />}
        {tab === 'tariff' && <TariffAdmin key={JSON.stringify(tariff)} tariff={tariff} reload={reload} />}
        {tab === 'users' && <UsersAdmin me={user} />}
      </main>

      {stolenAlert && (
        <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="stolen-h">
          <div className="stolen-alert">
            <span className="siren" aria-hidden="true" />
            <h2 id="stolen-h">O'g'irlangan mashina topildi</h2>
            <p className="plate xl">{stolenAlert.plate}</p>
            <dl className="facts">
              <dt>Joy</dt><dd>{stolenAlert.label}</dd>
              <dt>Aniqladi</dt><dd>{stolenAlert.inspector}</dd>
              <dt>Qidiruv</dt><dd>{stolenAlert.note || '—'}</dd>
              <dt>Vaqt</dt><dd>{time(stolenAlert.at)}</dd>
            </dl>
            <p className="muted small">Mashina chiqarilmaydi. Militsiyaga (102) xabar bering.</p>
            <button className="btn danger big" onClick={() => setStolenAlert(null)} autoFocus>Tushundim</button>
          </div>
        </div>
      )}

      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
