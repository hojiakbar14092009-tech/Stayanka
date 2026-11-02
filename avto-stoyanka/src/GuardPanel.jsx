// Qorovul paneli: tepadan ko'rilgan stoyanka rejasi + o'ng tomonda qidiruv, darvoza, skaner va amal kartasi
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, time, duration, calcFee, paintFor } from './api';
import Receipt from './Receipt';
import Ticket from './Ticket';
import ScanModal from './ScanModal';

const ZONES = ['A', 'B', 'C', 'D', 'E'];
// Three.js og'ir — alohida yuklanadi
const Gate3D = lazy(() => import('./Gate3D'));
// Sinov uchun tasodifiy O'zbekiston raqami: 01 A 123 BC
const LETTERS = 'ABCDEFHKMNOPSTXYZ';
const pickL = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
const randomPlate = () =>
  ['01', '10', '20', '25', '30', '40', '50', '60', '70', '75', '80', '85', '90', '95'][Math.floor(Math.random() * 14)] +
  pickL() + String(Math.floor(Math.random() * 900) + 100) + pickL() + pickL();
const norm = (v) => v.toUpperCase().replace(/[\s-]/g, '');

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
function Car({ plate, leaving, onDone }) {
  return (
    <svg className={leaving ? 'car leaving' : 'car'} onAnimationEnd={leaving ? onDone : undefined} viewBox="0 0 40 72" aria-hidden="true">
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

// Joy. Mashina yo'lakdan burilib kiradi; chiqqanda orqaga yurib, yo'lak bo'ylab ketadi (lane: r = o'ngga, l = chapga).
function Stall({ spot, face, lane, selected, found, onPick }) {
  const state = spot.is_disabled ? 'off' : spot.is_busy ? 'busy' : 'free';
  const title = spot.is_disabled ? "ta'mirda" : spot.is_busy ? `band, ${spot.plate}` : "bo'sh";
  // Chiqib ketayotgan mashinani animatsiya tugaguncha ko'rsatamiz
  const [prev, setPrev] = useState({ busy: spot.is_busy, plate: spot.plate });
  const [leaving, setLeaving] = useState(null);
  if (prev.busy !== spot.is_busy || prev.plate !== spot.plate) {
    if (prev.busy && !spot.is_busy) setLeaving(prev.plate);
    setPrev({ busy: spot.is_busy, plate: spot.plate });
  }
  return (
    <button
      data-spot={spot.id}
      className={`stall ${face} ${lane} ${state}${spot.is_premium ? ' premium' : ''}${selected ? ' selected' : ''}${found ? ' found' : ''}`}
      onClick={() => onPick(spot.id)}
      aria-label={`${spot.label}, ${title}`}
      aria-pressed={selected}
    >
      <span className="stall-no">{spot.label.slice(2)}</span>
      {spot.is_busy && <Car key={spot.session_id} plate={spot.plate} />}
      {leaving && <Car key="out" plate={leaving} leaving onDone={() => setLeaving(null)} />}
      {spot.is_busy && <span className="stall-plate">{spot.plate}</span>}
      {found && <span className="pin" aria-hidden="true">▼</span>}
    </button>
  );
}

// Moykachi: faqat mashina turgan joyga boradi. Mashinalar orasidan emas — yo'lak va chetki yo'lakcha bo'ylab yuradi.
const WALK_SPEED = 55; // px/s
function Washer({ lot, dirtyIds }) {
  const el = useRef(null);
  const dirty = useRef(dirtyIds);
  useEffect(() => { dirty.current = dirtyIds; }, [dirtyIds]);

  useEffect(() => {
    const lotEl = lot.current;
    const me = el.current;
    const speed = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1e6 : WALK_SPEED;
    const lanes = () => [...lotEl.querySelectorAll('.lane')].map((l) => l.offsetTop + l.offsetHeight / 2);
    const EDGE = 10; // zona chetidagi piyoda yo'lakcha
    const st = { x: EDGE, y: lanes()[0], laneY: lanes()[0], path: [], target: null, wash: 0, face: 1, sway: 0 };

    // Hozirgi joydan mashina yoniga yo'l: o'z yo'lagiga chiqadi → kerak bo'lsa chetdan boshqa yo'lakka → mashina yoniga
    const routeTo = (x, y, laneY) => {
      const p = [{ x: st.x, y: st.laneY }];
      if (laneY !== st.laneY) p.push({ x: EDGE, y: st.laneY }, { x: EDGE, y: laneY });
      p.push({ x, y: laneY }, { x, y });
      st.path = p;
      st.laneY = laneY;
    };
    const goWash = (id) => {
      const s = lotEl.querySelector(`[data-spot="${id}"]`);
      if (!s) return;
      const ls = lanes();
      const down = s.classList.contains('down');
      const laneY = down ? ls.find((y) => y > s.offsetTop) : [...ls].reverse().find((y) => y < s.offsetTop);
      // mashinaning yon tomoni, joyning ochiq qismiga yaqin
      routeTo(s.offsetLeft + s.offsetWidth / 2 + 24, s.offsetTop + s.offsetHeight * (down ? 0.62 : 0.38), laneY);
      st.target = id;
      st.wash = 0;
    };
    const next = () => {
      const ids = dirty.current;
      if (!ids.length) {
        const home = lanes()[0];
        st.target = null;
        if (st.x !== EDGE || st.y !== home) routeTo(EDGE, home, home);
        return;
      }
      const i = ids.indexOf(st.target);
      goWash(ids[(i + 1) % ids.length]);
    };

    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const ids = dirty.current;
      if (st.target && !ids.includes(st.target)) next(); // mashina ketdi — boshqasiga
      else if (!st.target && !st.path.length && ids.length) next();

      let mode = 'idle';
      if (st.path.length) {
        const p = st.path[0];
        const dx = p.x - st.x;
        const dy = p.y - st.y;
        const d = Math.hypot(dx, dy);
        const step = speed * dt;
        if (d <= step) {
          st.x = p.x;
          st.y = p.y;
          st.path.shift();
        } else {
          st.x += (dx / d) * step;
          st.y += (dy / d) * step;
        }
        if (Math.abs(dx) > 0.5) st.face = Math.sign(dx);
        mode = 'walking';
      } else if (st.target) {
        st.face = -1; // mashinaga qarab
        st.wash += dt;
        st.sway = Math.sin(st.wash * 1.3) * 4; // mashina bo'ylab u yoq-bu yoqqa
        mode = 'washing';
        if (st.wash > 8 && ids.length > 1) next();
      }
      me.className = `washer ${mode}`;
      me.style.transform = `translate(${st.x - 15 + (mode === 'washing' ? st.sway : 0)}px, ${st.y - 36}px) scaleX(${st.face})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lot]);

  return (
    <div className="washer" ref={el} aria-hidden="true">
      <svg viewBox="0 0 32 44">
        <circle cx="16" cy="7" r="6" fill="#e8b98f" />
        <path d="M10 5 Q16 -1 22 5 Z" fill="#2257d6" />
        <rect x="9" y="13" width="14" height="16" rx="4" fill="#2257d6" />
        <rect x="9" y="17" width="14" height="3" fill="#f2c230" />
        <rect className="leg-l" x="10" y="29" width="5" height="12" rx="2" fill="#3a3d43" />
        <rect className="leg-r" x="17" y="29" width="5" height="12" rx="2" fill="#3a3d43" />
        <g className="washer-arm"><rect x="21" y="14" width="10" height="4" rx="2" fill="#2257d6" /><rect x="28" y="10" width="4" height="9" rx="1.5" fill="#f2c230" /></g>
      </svg>
      <span className="bubbles"><i /><i /><i /><i /></span>
    </div>
  );
}

// Zona: 4 qator × 10 joy. Ikki qator orasida yo'lak, o'rtada bordyur. Premium zona — yopiq tom ostida.
function LotMap({ spots, selectedId, foundIds, onPick }) {
  const lot = useRef(null);
  const premium = spots[0]?.is_premium;
  const dirtyIds = useMemo(() => spots.filter((s) => s.is_premium && s.is_busy).map((s) => s.id), [spots]);

  const rows = [0, 1, 2, 3].map((r) => spots.slice(r * 10, r * 10 + 10));
  const row = (list, face, lane) => (
    <div className="stall-row">
      {list.map((s) => (
        <Stall key={s.id} spot={s} face={face} lane={lane} selected={s.id === selectedId} found={foundIds.has(s.id)} onPick={onPick} />
      ))}
    </div>
  );
  return (
    <div className="lot-scroll">
      <div className={`lot${premium ? ' covered' : ''}`} ref={lot}>
        {row(rows[0], 'down', 'r')}
        <div className="lane"><span>⟶</span><span>⟶</span><span>⟶</span></div>
        {row(rows[1], 'up', 'r')}
        <div className="curb">{premium && <span>Yopiq premium to'xtash joyi. Moykachi xizmatda</span>}</div>
        {row(rows[2], 'down', 'l')}
        <div className="lane"><span>⟵</span><span>⟵</span><span>⟵</span></div>
        {row(rows[3], 'up', 'l')}
        {premium && <Washer lot={lot} dirtyIds={dirtyIds} />}
      </div>
    </div>
  );
}

// Zona tabida 40 ta nuqtali mini-xarita: hamma bloklar bir qarashda, topilgan mashina yonadi
function MiniMap({ list, foundIds }) {
  return (
    <span className="mini" aria-hidden="true">
      {list.map((s) => (
        <i key={s.id} className={foundIds.has(s.id) ? 'hit' : s.is_disabled ? 'off' : s.is_busy ? 'busy' : ''} />
      ))}
    </span>
  );
}

export default function GuardPanel({ spots, tariff, reload, lastEvent, notify }) {
  const [zone, setZone] = useState('B');
  const [selectedId, setSelectedId] = useState(null);
  const [plate, setPlate] = useState('');
  const [search, setSearch] = useState('');
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [premium, setPremium] = useState(false); // mijoz premium joy so'radimi
  const [arrival, setArrival] = useState(null); // kamera oldiga kelgan mashina
  const [camRead, setCamRead] = useState('');
  const plateInput = useRef(null);
  const now = useNow();

  const selected = spots.find((s) => s.id === selectedId);
  // Ketma-ket to'ldirish: blok to'lmaguncha keyingisiga o'tilmaydi; premium faqat mijoz xohlasa
  const nextFree = useMemo(
    () => spots.find((s) => !s.is_busy && !s.is_disabled && s.is_premium === premium),
    [spots, premium]
  );

  // Kamera raqamni o'qidi — maydonga yoziladi, qorovul faqat tekshirib "Kirgizish"ni bosadi
  const plateRead = (p) => {
    setPlate(p);
    setCamRead(p);
    setSelectedId(null);
    plateInput.current?.focus();
  };
  // Qidiruv: hamma 200 joy bo'ylab — raqam yoki chek raqami bo'yicha
  const term = norm(search);
  const matches = term.length >= 2
    ? spots.filter((s) => s.is_busy && (s.plate.includes(term) || norm(s.ticket_no || '').includes(term)))
    : [];
  const foundIds = new Set(matches.map((s) => s.id));

  // Topilgan joyga o'tish: zona, tanlash va ko'rinishga aylantirish
  const goTo = (s) => {
    setZone(s.zone);
    setSelectedId(s.id);
    setTimeout(() => document.querySelector(`[data-spot="${s.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }), 50);
  };

  const findCar = (value) => {
    setSearch(value);
    const t = norm(value);
    const hit = t.length >= 2 && spots.find((s) => s.is_busy && (s.plate.includes(t) || norm(s.ticket_no || '').includes(t)));
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
      const { spot, ticket: t } = await api('/enter', {
        method: 'POST',
        body: { plate, premium, spot_id: selected && !selected.is_busy ? selected.id : undefined },
      });
      setPlate('');
      setCamRead('');
      setPremium(false);
      setSelectedId(null);
      setZone(spot.zone);
      setTicket(t);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      plateInput.current?.focus();
    }
  }

  // Skaner chekni o'qiydi (USB/QR skaner ham klaviatura kabi yozib Enter bosadi)
  function scan(e) {
    e.preventDefault();
    if (norm(scanCode).length < 4) return;
    setScanning(norm(scanCode));
    setScanCode('');
  }

  const afterExit = async (r) => {
    setScanning(null);
    setSelectedId(null);
    setReceipt(r);
    await reload().catch((e) => notify?.(e.message));
  };

  const zoneSpots = spots.filter((s) => s.zone === zone);
  const stayMs = selected?.entered_at ? now - new Date(selected.entered_at) : 0;
  const firstHour = (premium) => tariff && money(premium ? tariff.premium_hour : tariff.base_hour);

  return (
    <div className="guard">
      <section className="yard">
        <nav className="zones" aria-label="Zonalar">
          {ZONES.map((z) => {
            const list = spots.filter((s) => s.zone === z);
            const free = list.filter((s) => !s.is_busy && !s.is_disabled).length;
            const hits = list.filter((s) => foundIds.has(s.id)).length;
            return (
              <button key={z} className={`zone-tab${z === zone ? ' on' : ''}${list[0]?.is_premium ? ' premium' : ''}${hits ? ' has-hit' : ''}`} onClick={() => setZone(z)} aria-pressed={z === zone}>
                <b>{z}</b>
                <span>{z === 'A' ? 'Premium' : `Zona ${z}`}</span>
                <em>{hits ? `${hits} ta topildi` : `${free} bo'sh`}</em>
                <MiniMap list={list} foundIds={foundIds} />
              </button>
            );
          })}
        </nav>
        <LotMap spots={zoneSpots} selectedId={selectedId} foundIds={foundIds} onPick={pick} />
        <p className="legend">
          <span className="key free" /> bo'sh <span className="key busy" /> band <span className="key off" /> ta'mirda <span className="key premium" /> premium, yopiq
        </p>
      </section>

      <aside className="dock">
        <div className="finder">
          <input className="input search" placeholder="Mashinani topish: raqamning istalgan qismi" value={search} onChange={(e) => findCar(e.target.value)} aria-label="Mashinani topish" />
          {term.length >= 2 && (
            matches.length ? (
              <ul className="results">
                {matches.slice(0, 6).map((s) => (
                  <li key={s.id}>
                    <button onClick={() => goTo(s)}>
                      <span className="plate sm">{s.plate}</span>
                      <b>{s.label}</b>
                      <span className="muted">{time(s.entered_at)} dan</span>
                    </button>
                  </li>
                ))}
                {matches.length > 6 && <li className="muted small">yana {matches.length - 6} ta, raqamni to'liqroq yozing</li>}
              </ul>
            ) : <p className="muted">Bunday raqamli mashina stoyankada yo'q</p>
          )}
        </div>

        <form className="scan-form" onSubmit={scan}>
          <input className="input" placeholder="QR chekni skanerlang yoki raqamini yozing" value={scanCode} onChange={(e) => setScanCode(e.target.value)} aria-label="Chek raqami" />
          <button className="btn primary">Skaner</button>
        </form>

        <Suspense fallback={<div className="gate" />}>
          <Gate3D event={lastEvent} arrival={arrival} onPlateRead={plateRead} />
        </Suspense>
        <button className="btn ghost sm cam-demo" onClick={() => setArrival({ plate: randomPlate(), at: Date.now() })}>
          Kamera oldiga mashina keldi (sinov)
        </button>

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
              <button className="btn danger big" onClick={() => setScanning(selected.ticket_no)} disabled={!selected.ticket_no}>Chekni skanerlab chiqarish</button>
              <button className="btn ghost" onClick={() => setTicket({ ...selected, guard_in_name: selected.guard_name, active: true, tariff })}>Kirish chekini ko'rsatish</button>
            </>
          ) : (
            <form onSubmit={enter}>
              <h2>
                {selected ? <>{selected.label} joyiga kirgizish</> : <>Keyingi bo'sh joy: <span className="next">{nextFree?.label ?? "yo'q"}</span></>}
              </h2>
              {!selected && (
                <div className="seg wide" role="group" aria-label="Joy turi — mijoz tanlaydi">
                  <button type="button" className={premium ? '' : 'on'} onClick={() => setPremium(false)}>Oddiy joy</button>
                  <button type="button" className={premium ? 'on gold-on' : ''} onClick={() => setPremium(true)}>Premium, yopiq</button>
                </div>
              )}
              {camRead && plate === camRead && <p className="cam-hint">Kamera o'qidi. Raqamni tekshirib, kirgizing</p>}
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
              <button className="btn primary big" disabled={busy || !plate.trim() || (!selected && !nextFree)}>Kirgizish va chek berish</button>
              {tariff && (
                <p className="muted small">
                  1-soat {firstHour(selected ? selected.is_premium : premium)}, har keyingi soat +{money(tariff.step_hour)}
                </p>
              )}
            </form>
          )}
          {selected && <button className="btn ghost" onClick={() => setSelectedId(null)}>Bekor qilish</button>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </aside>

      {ticket && <Ticket ticket={ticket} onClose={() => setTicket(null)} />}
      {scanning && <ScanModal code={scanning} onClose={() => setScanning(null)} onExit={afterExit} />}
      {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
