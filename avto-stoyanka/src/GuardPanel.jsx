// Qorovul paneli: tepadan ko'rilgan stoyanka rejasi + o'ng tomonda qidiruv, darvoza (kamera), skaner va amal kartasi
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, time, duration, calcFee, paintFor, brandFor, washerWow, shapeFor, VIP_PERKS } from './api';
import Icon from './Icon';
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

// Joriy vaqt — jonli narx va turgan vaqt uchun har 10 soniyada yangilanadi
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Tepadan ko'rilgan mashina: markaga qarab sedan, SUV yoki sport shakli
const BODIES = {
  sedan: { body: 'M8 4 Q20 0 32 4 L36 16 L36 60 Q36 70 28 70 L12 70 Q4 70 4 60 L4 16 Z', glass: 'M9 22 Q20 15 31 22 L29 30 L11 30 Z', rear: 'M11 52 L29 52 L31 60 Q20 63 9 60 Z' },
  suv: { body: 'M7 3 L33 3 Q37 3 37 8 L37 65 Q37 70 32 70 L8 70 Q3 70 3 65 L3 8 Q3 3 7 3 Z', glass: 'M7 17 L33 17 L31 26 L9 26 Z', rear: 'M9 58 L31 58 L32 64 L8 64 Z' },
  sport: { body: 'M12 2 Q20 0 28 2 Q37 12 37 30 L36 62 Q34 70 26 70 L14 70 Q6 70 4 62 L3 30 Q3 12 12 2 Z', glass: 'M10 28 Q20 21 30 28 L28 36 L12 36 Z', rear: 'M12 52 L28 52 L29 57 Q20 60 11 57 Z' },
};
function Car({ plate, premium, leaving, onDone }) {
  const shape = BODIES[shapeFor(brandFor(plate, premium))];
  return (
    <svg className={leaving ? 'car leaving' : 'car'} onAnimationEnd={leaving ? onDone : undefined} viewBox="0 0 40 72" aria-hidden="true">
      <path d={shape.body} fill={paintFor(plate)} />
      <path d={shape.body} fill="url(#car-sheen)" />
      <path d={shape.glass} fill="#1b2430" />
      <path d={shape.rear} fill="#1b2430" />
      <rect x="6" y="3" width="7" height="3" rx="1.5" fill="#fff3c4" />
      <rect x="27" y="3" width="7" height="3" rx="1.5" fill="#fff3c4" />
      <rect x="6" y="66" width="7" height="3" rx="1.5" fill="#e5484d" />
      <rect x="27" y="66" width="7" height="3" rx="1.5" fill="#e5484d" />
      <rect x="1" y="24" width="3" height="4" rx="1" fill={paintFor(plate)} />
      <rect x="36" y="24" width="3" height="4" rx="1" fill={paintFor(plate)} />
    </svg>
  );
}

// Joy. Mashina yo'lakdan burilib kiradi; chiqqanda orqaga yurib, yo'lak bo'ylab ketadi (lane: r = o'ngga, l = chapga).
function Stall({ spot, face, lane, selected, found, onPick }) {
  const state = spot.is_disabled ? 'off' : spot.is_busy ? 'busy' : 'free';
  const title = spot.is_disabled ? "ta'mirda" : !spot.is_busy && spot.is_accessible ? "bo'sh, nogironlar uchun" : spot.is_busy ? `band, ${spot.plate}, ${brandFor(spot.plate, spot.is_premium)}` : "bo'sh";
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
      className={`stall ${face} ${lane} ${state}${spot.is_premium ? ' premium' : ''}${spot.is_accessible ? ' accessible' : ''}${selected ? ' selected' : ''}${found ? ' found' : ''}`}
      onClick={() => onPick(spot.id)}
      aria-label={`${spot.label}, ${title}`}
      aria-pressed={selected}
    >
      <span className={`stall-tag ${state}${spot.is_accessible ? " acc" : ""}`} aria-hidden="true"><i />{spot.label.slice(2)}</span>
      {spot.is_accessible && !spot.is_busy && <AccessSign />}
      {spot.is_busy && spot.disabled_driver && <span className="isa-badge" title="Nogironlar uchun bepul"><AccessSign small /></span>}
      {spot.is_busy && <Car key={spot.session_id} plate={spot.plate} premium={spot.is_premium} />}
      {leaving && <Car key="out" plate={leaving} premium={spot.is_premium} leaving onDone={() => setLeaving(null)} />}
      {spot.is_busy && <span className="stall-plate">{spot.plate}</span>}
      {found && <span className="pin" aria-hidden="true"><Icon name="pin" size="1.6em" /></span>}
    </button>
  );
}

// Joy yerida bo'yalgan xalqaro nogironlar belgisi
function AccessSign({ small }) {
  return (
    <svg className={small ? 'isa small' : 'isa'} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="3" fill="#1e5bd8" />
      <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="4.6" r="1.3" fill="#fff" />
        <path d="M11 7.5 V13 H15.8 L18 18 M11 10 H15" />
        <path d="M8.6 11 a5 5 0 1 0 6.9 7" />
      </g>
    </svg>
  );
}

// Joy tanlash: guvohnomasi bo'lsa — avval nogironlar joyi, bo'lmasa oddiy joy; oddiy mashina nogironlar joyiga qo'yilmaydi.
// Joy tasodifiy (bir blokka to'planmaydi), lekin band joylar soni o'zgarmaguncha bir xil — ekrandagi "Keyingi joy" bilan kiritilgani mos.
const pickFree = (list, prem, dd) => {
  const ok = (s) => !s.is_busy && !s.is_disabled && s.is_premium === prem;
  const acc = dd ? list.filter((s) => ok(s) && s.is_accessible) : [];
  const pool = acc.length ? acc : list.filter((s) => ok(s) && !s.is_accessible);
  if (!pool.length) return undefined;
  const busy = list.filter((s) => s.is_busy).length;
  return pool[(busy * 7919 + 13) % pool.length];
};

// Ichkaridagi mashinalar: kirgan vaqti, qancha turgani va hozirgi to'lov — vaqt o'tishi bilan o'zi qayta hisoblanadi
function InsideList({ spots, now, tariff, onPick }) {
  const inside = spots.filter((s) => s.is_busy && s.entered_at).sort((a, b) => new Date(b.entered_at) - new Date(a.entered_at));
  return (
    <div className="card inside">
      <h2>Ichkaridagi mashinalar <span className="muted">{inside.length} ta</span></h2>
      {inside.length ? (
        <div className="inside-scroll">
          <table className="table">
            <thead><tr><th>Raqam</th><th>Joy</th><th>Kirdi</th><th>Turdi</th><th className="num">To'lov</th></tr></thead>
            <tbody>
              {inside.map((s) => {
                const stay = now - new Date(s.entered_at);
                return (
                  <tr key={s.id}>
                    <td><button type="button" className="link mono" onClick={() => onPick(s)}>{s.plate}</button></td>
                    <td>{s.label}{s.is_premium ? ' (VIP)' : ''}</td>
                    <td>{time(s.entered_at)}</td>
                    <td>{duration(stay)}</td>
                    <td className="num">{s.disabled_driver ? 'Bepul' : tariff ? money(calcFee(stay, tariff, s.is_premium)) : '…'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">Hozir ichkarida mashina yo'q.</p>}
    </div>
  );
}

// Moykachilar jamoasi: har biri boshqa ko'rinishda, boshqa tezlikda, boshqa asbob bilan
const CREW = [
  { name: 'Sardor', skin: '#e8b98f', outfit: '#2257d6', cap: '#1b2a55', stripe: '#f2c230', pants: '#3a3d43', tool: 'sponge', speed: 52 },
  { name: 'Jasur', skin: '#c98f62', outfit: '#1f9a63', cap: '#f2c230', stripe: '#ffffff', pants: '#2a3140', tool: 'hose', speed: 46 },
  { name: 'Otabek', skin: '#f0caa4', outfit: '#c2410c', cap: '#ffffff', stripe: '#1b2430', pants: '#4a4d52', tool: 'brush', speed: 58 },
];
const TOOLS = {
  sponge: <rect x="28" y="11" width="6" height="5" rx="2" fill="#f2c230" />,
  hose: <><path d="M31 15 q4 -1 5 -5" stroke="#1b2430" strokeWidth="2" fill="none" /><circle cx="36" cy="9" r="1.6" fill="#9fd3ff" /></>,
  brush: <><rect x="29" y="8" width="2.5" height="9" rx="1" fill="#8a6a3a" /><rect x="27.5" y="6" width="5.5" height="3" rx="1" fill="#e5484d" /></>,
};

// Moykachi: faqat mashina turgan joyga boradi, mashinalar orasidan emas — yo'lak va chetki yo'lakcha bo'ylab yuradi.
// Qimmat mashinani ko'rsa, boshi yonida hayronlik xabari chiqadi.
function Washer({ lot, dirtyIds, crew, index, claims, plates }) {
  const el = useRef(null);
  const body = useRef(null);
  const say = useRef(null);
  const dirty = useRef(dirtyIds);
  const platesRef = useRef(plates);
  useEffect(() => {
    dirty.current = dirtyIds;
    platesRef.current = plates;
  }, [dirtyIds, plates]);

  useEffect(() => {
    const lotEl = lot.current;
    const me = el.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lanes = () => [...lotEl.querySelectorAll('.lane')].map((l) => l.offsetTop + l.offsetHeight / 2);
    const EDGE = 10 + index * 6; // zona chetidagi piyoda yo'lakcha
    const home = () => lanes()[index % 2];
    const st = { x: EDGE, y: home(), laneY: home(), path: [], target: null, wash: 0, face: 1, v: 0, sayUntil: 0, rest: index * 2.5 };

    const routeTo = (x, y, laneY) => {
      const p = [{ x: st.x, y: st.laneY }];
      if (laneY !== st.laneY) p.push({ x: EDGE, y: st.laneY }, { x: EDGE, y: laneY });
      p.push({ x, y: laneY }, { x, y });
      st.path = p;
      st.laneY = laneY;
    };
    const release = () => {
      if (st.target && claims.get(st.target) === index) claims.delete(st.target);
    };
    const goWash = (id) => {
      const s = lotEl.querySelector(`[data-spot="${id}"]`);
      if (!s) return;
      const ls = lanes();
      const down = s.classList.contains('down');
      const laneY = down ? ls.find((y) => y > s.offsetTop) : [...ls].reverse().find((y) => y < s.offsetTop);
      release();
      claims.set(id, index);
      routeTo(s.offsetLeft + s.offsetWidth / 2 + 24, s.offsetTop + s.offsetHeight * (down ? 0.62 : 0.38), laneY);
      st.target = id;
      st.wash = 0;
      st.greeted = false;
    };
    // Boshqa moykachi band qilmagan mashinani tanlaydi
    const next = () => {
      const free = dirty.current.filter((id) => !claims.has(id) || claims.get(id) === index);
      const options = free.filter((id) => id !== st.target);
      if (!options.length && !free.includes(st.target)) {
        release();
        st.target = null;
        if (st.x !== EDGE || st.y !== home()) routeTo(EDGE, home(), home());
        return;
      }
      if (options.length) goWash(options[(index + Math.floor(Math.random() * options.length)) % options.length]);
    };

    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      if (st.rest > 0) st.rest -= dt; // jamoa birdan emas, navbat bilan ishga tushadi
      else if (st.target && !dirty.current.includes(st.target)) next(); // mashina ketdi — boshqasiga
      else if (!st.target && !st.path.length) next();

      let mode = 'idle';
      if (st.path.length) {
        const p = st.path[0];
        const dx = p.x - st.x;
        const dy = p.y - st.y;
        const d = Math.hypot(dx, dy);
        // yumshoq tezlanish va to'xtash
        const want = reduced ? 1e6 : crew.speed * Math.min(1, 0.35 + d / 40);
        st.v += (want - st.v) * Math.min(1, dt * 4);
        const step = st.v * dt;
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
        st.v = 0;
        st.face = -1; // mashinaga qarab
        st.wash += dt;
        mode = 'washing';
        if (!st.greeted) {
          st.greeted = true;
          const brand = brandFor(platesRef.current[st.target] || '', true);
          if (washerWow(brand)) {
            say.current.querySelector('b').textContent = `Vuy j....b, ${brand}-mi?!`;
            st.sayUntil = t + 3.6;
          }
        }
        if (st.wash > 9 + index * 2) next();
      }
      const sway = mode === 'washing' ? Math.sin(st.wash * 1.4 + index) * 4 : 0;
      const breathe = mode === 'idle' ? Math.sin(t * 2 + index) * 0.6 : 0;
      me.className = `washer crew-${index} ${mode}`;
      me.style.transform = `translate(${st.x - 15 + sway}px, ${st.y - 36 + breathe}px)`;
      body.current.style.transform = `scaleX(${st.face})`;
      say.current.className = `washer-say${t < st.sayUntil ? ' on' : ''}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      release();
    };
  }, [lot, crew, index, claims]);

  return (
    <div className="washer" ref={el} aria-hidden="true">
      <div className="washer-say" ref={say}>
        <span className="wow"><Icon name="wow" size="1.3em" /><Icon name="crown" size="1em" /></span>
        <b />
      </div>
      <div className="washer-body" ref={body}>
        <svg viewBox="0 0 38 44">
          <circle cx="16" cy="7" r="6" fill={crew.skin} />
          <path d="M10 5 Q16 -1 22 5 Z" fill={crew.cap} />
          <rect x="21" y="4" width="4" height="1.6" rx=".8" fill={crew.cap} />
          <rect x="9" y="13" width="14" height="16" rx="4" fill={crew.outfit} />
          <rect x="9" y="17" width="14" height="2.5" fill={crew.stripe} />
          <rect x="9" y="22" width="14" height="2.5" fill={crew.stripe} opacity=".7" />
          <rect className="leg-l" x="10" y="29" width="5" height="12" rx="2" fill={crew.pants} />
          <rect className="leg-r" x="17" y="29" width="5" height="12" rx="2" fill={crew.pants} />
          <g className="washer-arm"><rect x="21" y="14" width="10" height="4" rx="2" fill={crew.outfit} />{TOOLS[crew.tool]}</g>
        </svg>
        <span className="bubbles"><i /><i /><i /><i /></span>
      </div>
    </div>
  );
}

// Zona: 4 qator × 10 joy. Ikki qator orasida yo'lak, o'rtada bordyur. Premium zona — yopiq tom ostida.
function LotMap({ spots, selectedId, foundIds, onPick }) {
  const lot = useRef(null);
  const claims = useMemo(() => new Map(), []); // qaysi mashinani qaysi moykachi yuvyapti
  const premium = spots[0]?.is_premium;
  const dirtyIds = useMemo(() => spots.filter((s) => s.is_premium && s.is_busy).map((s) => s.id), [spots]);
  const plates = useMemo(() => Object.fromEntries(spots.map((s) => [s.id, s.plate])), [spots]);

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
      {premium && (
        <div className="vip-perks">
          <h3><Icon name="crown" /> VIP qulayliklari</h3>
          <table>
            <tbody>
              {VIP_PERKS.map(([text, icon]) => (
                <tr key={text}><td><Icon name={icon} /></td><td>{text}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <svg width="0" height="0" aria-hidden="true">
        <defs>
          <linearGradient id="car-sheen" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#000" stopOpacity=".25" />
            <stop offset=".35" stopColor="#fff" stopOpacity=".18" />
            <stop offset=".6" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".28" />
          </linearGradient>
        </defs>
      </svg>
      <div className={`lot${premium ? ' covered' : ''}`} ref={lot}>
        {row(rows[0], 'down', 'r')}
        <div className="lane"><span>⟶</span><span>⟶</span><span>⟶</span></div>
        {row(rows[1], 'up', 'r')}
        <div className="curb">{premium && <span><Icon name="crown" /> VIP to'xtash joyi. Moykachilar xizmatda <Icon name="drop" /></span>}</div>
        {row(rows[2], 'down', 'l')}
        <div className="lane"><span>⟵</span><span>⟵</span><span>⟵</span></div>
        {row(rows[3], 'up', 'l')}
        {premium && CREW.map((c, i) => <Washer key={c.name} lot={lot} dirtyIds={dirtyIds} crew={c} index={i} claims={claims} plates={plates} />)}
      </div>
    </div>
  );
}

// Zona tabida 40 ta nuqtali mini-xarita: hamma bloklar bir qarashda, topilgan mashina yonadi
function MiniMap({ list, foundIds }) {
  return (
    <span className="mini" aria-hidden="true">
      {list.map((s) => (
        <i key={s.id} className={foundIds.has(s.id) ? 'hit' : s.is_disabled ? 'off' : s.is_busy ? 'busy' : s.is_accessible ? 'acc' : ''} />
      ))}
    </span>
  );
}

let lastAuto = Date.now() - 55000; // birinchi daqiqa panel ochilgandan ~5 soniyadan keyin boshlanadi

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
  const [premium, setPremium] = useState(false); // qo'lda kiritishda: mijoz premium joy so'radimi
  const [disabledDriver, setDisabledDriver] = useState(false); // nogironlik guvohnomasi — bepul
  const [arrival, setArrival] = useState(null); // kamera oldiga kelgan mashina
  const [arrived, setArrived] = useState(null); // kamera o'qigan va avtomatik kiritilgan mashina
  const [reject, setReject] = useState(null); // kiritib bo'lmadi — mashina orqaga qaytariladi
  const [release, setRelease] = useState(null); // chek berildi — shlagbaum ochiladi
  const [hidden, setHidden] = useState(() => new Set()); // bazada band, lekin mashina hali darvozada — rejada ko'rsatilmaydi
  const [arrivePremium, setArrivePremium] = useState(false);
  const [arriveDisabled, setArriveDisabled] = useState(false);
  const plateInput = useRef(null);
  // Avtomatik oqim: har daqiqada 1 mashina cheki skanerlanib chiqadi va 3 mashina kelib chek oladi — hammasi ekranda
  const [auto, setAuto] = useState(true);
  const autoOut = useRef(false); // ochiq skaner/chiqish cheki avtomatik oqimniki
  const autoIn = useRef(false); // darvozadagi mashina avtomatik oqimniki
  const live = useRef({});
  const now = useNow();

  const selected = spots.find((s) => s.id === selectedId);
  // Ketma-ket to'ldirish: blok to'lmaguncha keyingisiga o'tilmaydi; premium faqat mijoz xohlasa
  const nextFree = useMemo(
    () => pickFree(spots, premium, disabledDriver),
    [spots, premium, disabledDriver]
  );

  // Kamera raqamni o'qidi → mashina shlagbaum oldida kutadi, joy avtomatik tanlanadi.
  // Qorovul chekni chop etib bergandan keyingina mashina kiradi (yoki cheksiz kirgizadi).
  const plateRead = (p) => {
    setArrivePremium(false);
    setArriveDisabled(false);
    setArrived({ plate: p, status: 'read' });
  };

  // Mashinani ichkariga qo'yish: shlagbaum ochiladi, rejada mashina darvozadan o'tgach paydo bo'ladi
  const letIn = (spotId, p, label) => {
    setRelease({ plate: p, label, at: Date.now() });
    setArrived(null);
    setTimeout(() => setHidden((h) => {
      const n = new Set(h);
      n.delete(spotId);
      return n;
    }), 2600);
  };

  async function admit(print) {
    const p = arrived.plate;
    setArrived({ plate: p, status: 'saving' });
    try {
      const { spot, ticket: t } = await api('/enter', { method: 'POST', body: { plate: p, premium: arrivePremium, disabled_driver: arriveDisabled, spot_id: live.current.readyFree?.id } });
      setHidden((h) => new Set(h).add(spot.id));
      setSelectedId(null);
      setZone(spot.zone);
      await reload();
      if (print) {
        setArrived({ plate: p, status: 'printing', spot, ticket: t });
        setTicket({ ...t, handover: true });
      } else {
        letIn(spot.id, p, spot.label);
      }
    } catch (err) {
      setArrived({ plate: p, status: 'error', error: err.message });
    }
  }

  // Chek oynasi yopildi: agar bu darvozadagi mashinaning cheki bo'lsa — haydovchiga berildi, mashina kiradi
  const closeTicket = () => {
    if (ticket?.handover) letIn(ticket.spot_id, ticket.plate, spots.find((s) => s.id === ticket.spot_id)?.label);
    setTicket(null);
  };

  useEffect(() => {
    if (!auto) return;
    let plan = []; // shu daqiqaning qadamlari: [tur, qachondan]
    const tick = () => {
      const t = Date.now();
      if (!plan.length) {
        // Daqiqa boshi vaqti modulda: panel qayta ochilsa ham daqiqasiga 1 chiqish + 3 kirishdan oshmaydi
        if (t - lastAuto < 60000) return;
        lastAuto = t;
        plan = [['out', t], ['in', t + 12000], ['in', t + 28000], ['in', t + 44000]];
      }
      const { ticket, scanning, receipt, arrived, view } = live.current;
      if (ticket || scanning || receipt || arrived || t < plan[0][1]) return; // qorovul o'zi ishlayapti yoki vaqti kelmadi — keyinroq
      const [kind] = plan.shift();
      if (kind === 'out') {
        const parked = view.filter((x) => x.is_busy && x.ticket_no);
        const out = parked[Math.floor(Math.random() * parked.length)];
        if (out) {
          autoOut.current = true;
          setScanning(out.ticket_no);
        }
      } else {
        autoIn.current = true;
        setArrival({ plate: randomPlate(), at: t });
      }
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [auto]);

  // Avtomatik qadamlar: kamera o'qidi → chek chop etiladi → chek berildi, mashina kiradi
  useEffect(() => {
    if (!autoIn.current || !arrived) return;
    const step = arrived.status === 'read'
      ? () => (live.current.readyFree ? admit(true) : (setReject({ plate: arrived.plate, at: Date.now() }), setArrived(null), (autoIn.current = false)))
      : arrived.status === 'error'
        ? () => { setReject({ plate: arrived.plate, at: Date.now() }); setArrived(null); autoIn.current = false; }
        : null;
    if (!step) return;
    const t = setTimeout(step, 2500);
    return () => clearTimeout(t);
  }, [arrived?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoIn.current || !ticket?.handover) return;
    const t = setTimeout(() => { autoIn.current = false; closeTicket(); }, 4500);
    return () => clearTimeout(t);
  }, [ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoOut.current || !receipt) return;
    const t = setTimeout(() => { autoOut.current = false; setReceipt(null); }, 4500);
    return () => clearTimeout(t);
  }, [receipt]);

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

  // Qo'lda kiritish (kamera ishlamasa yoki piyoda kelgan mijoz uchun)
  async function enter(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { spot, ticket: t } = await api('/enter', {
        method: 'POST',
        body: { plate, premium, disabled_driver: disabledDriver, spot_id: selected && !selected.is_busy ? selected.id : nextFree?.id },
      });
      setPlate('');
      setPremium(false);
      setDisabledDriver(false);
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

  const view = hidden.size ? spots.map((s) => (hidden.has(s.id) ? { ...s, is_busy: false, plate: null, session_id: null } : s)) : spots;
  const zoneSpots = view.filter((s) => s.zone === zone);
  const readyFree = pickFree(spots, arrivePremium, arriveDisabled); // haqiqiy band joylar bo'yicha (darvozadagi mashinaning joyi ham band)
  live.current = { ticket, scanning, receipt, arrived, view, readyFree };
  const stayMs = selected?.entered_at ? now - new Date(selected.entered_at) : 0;
  const firstHour = (prem) => tariff && money(prem ? tariff.premium_hour : tariff.base_hour);

  return (
    <div className="guard">
      <section className="yard">
        <nav className="zones" aria-label="Zonalar">
          {ZONES.map((z) => {
            const list = view.filter((s) => s.zone === z);
            const free = list.filter((s) => !s.is_busy && !s.is_disabled).length;
            const hits = list.filter((s) => foundIds.has(s.id)).length;
            return (
              <button key={z} className={`zone-tab${z === zone ? ' on' : ''}${list[0]?.is_premium ? ' premium' : ''}${hits ? ' has-hit' : ''}`} onClick={() => setZone(z)} aria-pressed={z === zone}>
                <b>{z}</b>
                <span>{z === 'A' ? <><Icon name="crown" size="1em" /> VIP</> : `Zona ${z}`}</span>
                <em>{hits ? `${hits} ta topildi` : `${free} bo'sh`}</em>
                <MiniMap list={list} foundIds={foundIds} />
              </button>
            );
          })}
        </nav>
        <LotMap spots={zoneSpots} selectedId={selectedId} foundIds={foundIds} onPick={pick} />
        <p className="legend">
          <span className="key free" /> bo'sh <span className="key busy" /> band <span className="key off" /> ta'mirda <Icon name="crown" /> VIP, yopiq <AccessSign small /> nogironlar uchun, bepul
        </p>
        <InsideList spots={spots} now={now} tariff={tariff} onPick={goTo} />
      </section>

      <aside className="dock">
        <div className="finder">
          <label className="input-icon">
            <Icon name="search" />
            <input className="input search" placeholder="Mashinani topish: raqamning istalgan qismi" value={search} onChange={(e) => findCar(e.target.value)} aria-label="Mashinani topish" />
          </label>
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
          <label className="input-icon">
            <Icon name="scan" />
            <input className="input" placeholder="QR chekni skanerlang yoki raqamini yozing" value={scanCode} onChange={(e) => setScanCode(e.target.value)} aria-label="Chek raqami" />
          </label>
          <button className="btn primary"><Icon name="scan" /> Skaner</button>
        </form>

        <Suspense fallback={<div className="gate" />}>
          <Gate3D event={lastEvent} arrival={arrival} reject={reject} release={release} spots={view} focusZone={zone} onPlateRead={plateRead} />
        </Suspense>
        <button className="btn ghost sm cam-demo" onClick={() => setArrival({ plate: randomPlate(), at: Date.now() })}>
          <Icon name="camera" /> Kamera oldiga mashina keldi (sinov)
        </button>
        <button className={`btn ghost sm cam-demo${auto ? ' on' : ''}`} onClick={() => setAuto((v) => !v)} aria-pressed={auto}>
          {auto ? 'Avtomatik oqim: yoqilgan (har daqiqada 3 kirish, 1 chiqish)' : "Avtomatik oqim: o'chirilgan"}
        </button>

        {arrived && (
          <div className={`card arrived ${arrived.status}`} role="status">
            <p className="arrived-head"><Icon name="camera" /> Kamera o'qigan raqam</p>
            <p className="plate xl">{arrived.plate}</p>
            {arrived.status === 'read' && (
              <>
                <p className="arrived-spot">
                  <Icon name="pin" /> Joy tayyor: <b>{readyFree?.label ?? "bo'sh joy yo'q"}</b>
                  <span className="muted"> {brandFor(arrived.plate, arrivePremium)}</span>
                </p>
                <div className="seg wide" role="group" aria-label="Joy turi — mijoz tanlaydi">
                  <button type="button" className={arrivePremium ? '' : 'on'} onClick={() => setArrivePremium(false)}>Oddiy joy</button>
                  <button type="button" className={arrivePremium ? 'on gold-on' : ''} onClick={() => setArrivePremium(true)}><Icon name="crown" /> VIP</button>
                </div>
                <button type="button" className={`btn access-toggle${arriveDisabled ? ' on' : ''}`} onClick={() => setArriveDisabled((v) => !v)} aria-pressed={arriveDisabled}>
                  <AccessSign small /> Nogironlik guvohnomasi bor{arriveDisabled ? ': bepul' : ''}
                </button>
                <p className="muted small">Mashina shlagbaum oldida kutmoqda. Chek berilgach kiradi.</p>
                <div className="arrived-actions">
                  <button className="btn primary" onClick={() => admit(true)} disabled={!readyFree}>
                    <Icon name="print" /> Chek chop etish
                  </button>
                  <button className="btn ghost" onClick={() => admit(false)} disabled={!readyFree}>Cheksiz kirgizish</button>
                </div>
                {!readyFree && (
                  <button className="btn danger" onClick={() => { setReject({ plate: arrived.plate, at: Date.now() }); setArrived(null); }}>
                    <Icon name="exit" /> Mashinani qaytarish
                  </button>
                )}
              </>
            )}
            {arrived.status === 'saving' && <p className="muted">Joy band qilinmoqda…</p>}
            {arrived.status === 'printing' && (
              <p className="arrived-spot"><Icon name="print" /> Chek chop etilmoqda: <b>{arrived.spot.label}</b>. Chekni haydovchiga bering.</p>
            )}
            {arrived.status === 'error' && (
              <>
                <p className="error" role="alert"><Icon name="warning" /> {arrived.error}</p>
                <div className="arrived-actions">
                  <button className="btn danger" onClick={() => { setReject({ plate: arrived.plate, at: Date.now() }); setArrived(null); }}>
                    <Icon name="exit" /> Mashinani qaytarish
                  </button>
                  <button className="btn ghost" onClick={() => setArrived({ plate: arrived.plate, status: 'read' })}>Qayta urinish</button>
                </div>
              </>
            )}
          </div>
        )}

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
                <dt>Marka</dt><dd>{brandFor(selected.plate, selected.is_premium)}</dd>
                <dt>Kirdi</dt><dd>{time(selected.entered_at)}</dd>
                <dt>Turibdi</dt><dd>{duration(stayMs)}</dd>
                <dt>Hozirgi narx</dt><dd className="price">{selected.disabled_driver ? <>Bepul <AccessSign small /></> : tariff && money(calcFee(stayMs, tariff, selected.is_premium))}</dd>
              </dl>
              <button className="btn danger big" onClick={() => setScanning(selected.ticket_no)} disabled={!selected.ticket_no}>
                <Icon name="scan" /> Chekni skanerlab chiqarish
              </button>
              <button className="btn ghost" onClick={() => setTicket({ ...selected, guard_in_name: selected.guard_name, active: true, tariff })}>
                <Icon name="ticket" /> Kirish chekini ko'rsatish
              </button>
            </>
          ) : (
            <form onSubmit={enter}>
              <h2>
                {selected ? <>{selected.label} joyiga kirgizish</> : <>Qo'lda kiritish. Keyingi joy: <span className="next">{nextFree?.label ?? "yo'q"}</span></>}
              </h2>
              {!selected && (
                <div className="seg wide" role="group" aria-label="Joy turi — mijoz tanlaydi">
                  <button type="button" className={premium ? '' : 'on'} onClick={() => setPremium(false)}>Oddiy joy</button>
                  <button type="button" className={premium ? 'on gold-on' : ''} onClick={() => setPremium(true)}><Icon name="crown" /> VIP</button>
                </div>
              )}
              <button type="button" className={`btn access-toggle${disabledDriver ? ' on' : ''}`} onClick={() => setDisabledDriver((v) => !v)} aria-pressed={disabledDriver}>
                <AccessSign small /> Nogironlik guvohnomasi bor{disabledDriver ? ': bepul' : ''}
              </button>
              <input
                ref={plateInput}
                className="input plate-input"
                placeholder="01 A 123 BC"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                aria-label="Mashina raqami"
                maxLength={14}
              />
              <button className="btn primary big" disabled={busy || !plate.trim() || (!selected && !nextFree)}>
                <Icon name="ticket" /> Kirgizish va chek berish
              </button>
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

      {ticket && <Ticket ticket={ticket} onClose={closeTicket} closeLabel={ticket.handover ? 'Chek berildi, kirgizish' : 'Yopish'} />}
      {scanning && <ScanModal code={scanning} auto={autoOut.current} onClose={() => { autoOut.current = false; setScanning(null); }} onExit={afterExit} />}
      {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}
