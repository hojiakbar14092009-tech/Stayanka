// Qorovul paneli: tepadan ko'rilgan stoyanka rejasi + o'ng tomonda darvoza va amal kartasi
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, time, duration, calcFee, paintFor } from './api';
import Receipt from './Receipt';

const ZONES = ['A', 'B', 'C', 'D', 'E'];
// Three.js og'ir — alohida yuklanadi
const Gate3D = lazy(() => import('./Gate3D'));

// Joriy vaqt — jonli narx va turgan vaqt uchun har 20 soniyada yangilanadi
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Tepadan ko'rilgan mashina
function Car({ plate }) {
  return (
    <svg className="car" viewBox="0 0 40 72" aria-hidden="true">
      <rect x="3" y="2" width="34" height="68" rx="11" fill={paintFor(plate)} />
      <path d="M8 22 Q20 14 32 22 L30 30 L10 30 Z" fill="#1b2430" />
      <rect x="10" y="31" width="20" height="20" rx="3" fill="rgba(0,0,0,.18)" />
      <path d="M10 52 L30 52 L32 60 Q20 64 8 60 Z" fill="#1b2430" />
      <rect x="6" y="3" width="7" height="3" rx="1.5" fill="#fff3c4" />
      <rect x="27" y="3" width="7" height="3" rx="1.5" fill="#fff3c4" />
      <rect x="6" y="66" width="7" height="3" rx="1.5" fill="#e5484d" />
      <rect x="27" y="66" width="7" height="3" rx="1.5" fill="#e5484d" />
    </svg>
  );
}

function Stall({ spot, face, selected, found, onPick }) {
  const state = spot.is_disabled ? 'off' : spot.is_busy ? 'busy' : 'free';
  const title = spot.is_disabled ? "ta'mirda" : spot.is_busy ? `band, ${spot.plate}` : "bo'sh";
  return (
    <button
      className={`stall ${face} ${state}${spot.is_premium ? ' premium' : ''}${selected ? ' selected' : ''}${found ? ' found' : ''}`}
      onClick={() => onPick(spot.id)}
      aria-label={`${spot.label}, ${title}`}
      aria-pressed={selected}
    >
      <span className="stall-no">{spot.label.slice(2)}</span>
      {spot.is_busy && <Car key={spot.session_id} plate={spot.plate} />}
      {spot.is_busy && <span className="stall-plate">{spot.plate}</span>}
    </button>
  );
}

// Zona: 4 qator × 10 joy. Ikki qator orasida yo'lak, o'rtada bordyur.
function LotMap({ spots, selectedId, foundId, onPick }) {
  const rows = [0, 1, 2, 3].map((r) => spots.slice(r * 10, r * 10 + 10));
  const row = (list, face) => (
    <div className="stall-row">
      {list.map((s) => (
        <Stall key={s.id} spot={s} face={face} selected={s.id === selectedId} found={s.id === foundId} onPick={onPick} />
      ))}
    </div>
  );
  return (
    <div className="lot-scroll">
      <div className="lot">
        {row(rows[0], 'down')}
        <div className="lane"><span>⟶</span><span>⟶</span><span>⟶</span></div>
        {row(rows[1], 'up')}
        <div className="curb" />
        {row(rows[2], 'down')}
        <div className="lane"><span>⟵</span><span>⟵</span><span>⟵</span></div>
        {row(rows[3], 'up')}
      </div>
    </div>
  );
}

export default function GuardPanel({ spots, tariff, reload, lastEvent, notify }) {
  const [zone, setZone] = useState('B');
  const [selectedId, setSelectedId] = useState(null);
  const [plate, setPlate] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const plateInput = useRef(null);
  const now = useNow();

  const selected = spots.find((s) => s.id === selectedId);
  const nextFree = useMemo(
    () => spots.filter((s) => !s.is_busy && !s.is_disabled).sort((a, b) => a.is_premium - b.is_premium || a.id - b.id)[0],
    [spots]
  );
  const term = search.toUpperCase().replace(/[\s-]/g, '');
  const found = term.length >= 2 ? spots.find((s) => s.plate?.includes(term)) : null;


  // Qidiruv: topilgan mashina zonasiga o'tamiz
  const findCar = (value) => {
    setSearch(value);
    const t = value.toUpperCase().replace(/[s-]/g, '');
    const hit = t.length >= 2 && spots.find((s) => s.plate?.includes(t));
    if (hit) setZone(hit.zone);
  };

  const pick = (id) => {
    setSelectedId(id === selectedId ? null : id);
    setError('');
    setTimeout(() => plateInput.current?.focus());
  };

  async function enter(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { spot } = await api('/enter', { method: 'POST', body: { plate, spot_id: selected && !selected.is_busy ? selected.id : undefined } });
      setPlate('');
      setSelectedId(null);
      setZone(spot.zone);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      plateInput.current?.focus();
    }
  }

  async function exit() {
    setBusy(true);
    setError('');
    try {
      setReceipt(await api(`/exit/${selected.id}`, { method: 'PUT' }));
      setSelectedId(null);
      await reload();
    } catch (err) {
      setError(err.message);
      notify?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  const zoneSpots = spots.filter((s) => s.zone === zone);
  const stayMs = selected?.entered_at ? now - new Date(selected.entered_at) : 0;

  return (
    <div className="guard">
      <section className="yard">
        <nav className="zones" aria-label="Zonalar">
          {ZONES.map((z) => {
            const list = spots.filter((s) => s.zone === z);
            const free = list.filter((s) => !s.is_busy && !s.is_disabled).length;
            return (
              <button key={z} className={`zone-tab${z === zone ? ' on' : ''}${list[0]?.is_premium ? ' premium' : ''}`} onClick={() => setZone(z)} aria-pressed={z === zone}>
                <b>{z}</b>
                <span>{z === 'A' ? 'Premium' : `Zona ${z}`}</span>
                <em>{free} bo'sh</em>
                <i style={{ '--fill': `${list.length ? ((list.length - free) / list.length) * 100 : 0}%` }} />
              </button>
            );
          })}
        </nav>
        <LotMap spots={zoneSpots} selectedId={selectedId} foundId={found?.id} onPick={pick} />
        <p className="legend">
          <span className="key free" /> bo'sh <span className="key busy" /> band <span className="key off" /> ta'mirda <span className="key premium" /> premium
        </p>
      </section>

      <aside className="dock">
        <input className="input search" placeholder="Mashinani topish: raqam" value={search} onChange={(e) => findCar(e.target.value)} aria-label="Mashinani raqam bo'yicha topish" />
        {term.length >= 2 && (
          <p className={found ? 'found-msg' : 'muted'}>
            {found ? <>Topildi: <b>{found.plate}</b> {found.label} joyida, {time(found.entered_at)} dan beri</> : "Bunday raqamli mashina stoyankada yo'q"}
          </p>
        )}

        <Suspense fallback={<div className="gate" />}><Gate3D event={lastEvent} /></Suspense>

        <div className="card action" key={selected?.id ?? 'quick'}>
          {selected?.is_disabled ? (
            <>
              <h2>{selected.label}</h2>
              <p className="muted">Bu joy ta'mirda. Boshqa joy tanlang.</p>
            </>
          ) : selected?.is_busy ? (
            <>
              <h2>{selected.label} <small>band</small></h2>
              <p className="plate lg">{selected.plate}</p>
              <dl className="facts">
                <dt>Kirdi</dt><dd>{time(selected.entered_at)}</dd>
                <dt>Turibdi</dt><dd>{duration(stayMs)}</dd>
                <dt>Hozirgi narx</dt><dd className="price">{tariff && money(calcFee(stayMs, tariff, selected.is_premium))}</dd>
              </dl>
              <button className="btn danger big" onClick={exit} disabled={busy}>Chiqarish va chek berish</button>
            </>
          ) : (
            <form onSubmit={enter}>
              <h2>
                {selected ? <>{selected.label} joyiga kirgizish</> : <>Keyingi bo'sh joy: <span className="next">{nextFree?.label ?? "yo'q"}</span></>}
              </h2>
              <input
                ref={plateInput}
                className="input plate-input"
                placeholder="01 A 123 BC"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                aria-label="Mashina raqami"
                autoFocus
                maxLength={14}
              />
              <button className="btn primary big" disabled={busy || !plate.trim() || (!selected && !nextFree)}>Kirgizish</button>
              {tariff && (
                <p className="muted small">
                  1-soat {money(tariff.base_hour)}, har keyingi soat +{money(tariff.step_hour)}
                  {(selected?.is_premium ?? false) && `, premium × ${tariff.premium_mult}`}
                </p>
              )}
            </form>
          )}
          {selected && <button className="btn ghost" onClick={() => setSelectedId(null)}>Bekor qilish</button>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </aside>

      {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
