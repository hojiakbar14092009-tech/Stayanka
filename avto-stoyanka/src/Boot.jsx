// Haqiqiy yuklanish: har bir bosqich haqiqatan bajariladi (shrift, 3D modullar, server, sessiya).
// Foiz — tugagan bosqichlar ulushi; har bosqich tugaganda bitta mashina o'z joyiga kiradi.
// Server javob bermasa — oflayn rejim: sahifa ochiladi, ulanish tiklanganda o'zi qayta tekshiradi.
import { useEffect, useRef, useState } from 'react';
import { api, API, getToken } from './api';

const MIN_MS = 700; // juda tez bo'lsa ham bosqichlar ko'zga ko'rinsin

async function reachServer() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${API}/health`, { signal: ctrl.signal, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const TASKS = [
  ['Shriftlar', async () => { await document.fonts?.ready; }],
  ['3D dvigatel va personajlar', () => import('./LoginScene')],
  ['Darvoza sahnasi', () => import('./Gate3D')],
  ['Server bilan aloqa', async (ctx) => { ctx.online = await reachServer(); }],
  ['Smena sessiyasi', async (ctx) => {
    if (ctx.online && getToken()) ctx.user = await api('/me').catch(() => null);
  }],
];

export default function Boot({ onReady }) {
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState(TASKS[0][0]);
  const [offline, setOffline] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode ikki marta chaqirmasin
    ran.current = true;
    (async () => {
      const start = performance.now();
      const ctx = { online: navigator.onLine, user: null };
      for (const [i, [label, run]] of TASKS.entries()) {
        setCurrent(label);
        try {
          await run(ctx);
        } catch {
          // modul yuklanmadi (oflayn) — davom etamiz, keyin qayta urinadi
        }
        setDone(i + 1);
      }
      setOffline(!ctx.online);
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_MS - (performance.now() - start))));
      setLeaving(true);
      setTimeout(() => onReady(ctx), 450);
    })();
  }, [onReady]);

  const pct = Math.round((done / TASKS.length) * 100);
  return (
    <main className={`boot${leaving ? ' leaving' : ''}`} aria-busy={!leaving} aria-label="Yuklanmoqda">
      <div className="boot-sign" aria-hidden="true"><span>P</span></div>
      <h1>AvtoStoyanka</h1>
      <div className="boot-lot" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${pct}%, ${current}`}>
        {TASKS.map(([label], i) => (
          <div key={label} className={`boot-stall${i < done ? ' filled' : i === done ? ' next' : ''}`}>
            <i className="boot-car" />
          </div>
        ))}
      </div>
      <p className="boot-pct">{pct}%</p>
      <ol className="boot-steps">
        {TASKS.map(([label], i) => (
          <li key={label} className={i < done ? 'ok' : i === done ? 'now' : ''}>{label}</li>
        ))}
      </ol>
      {offline && <p className="boot-offline">Oflayn: server bilan aloqa yo'q. Ulanish tiklanganda o'zi davom etadi.</p>}
    </main>
  );
}
