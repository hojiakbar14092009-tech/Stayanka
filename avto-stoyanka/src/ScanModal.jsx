// Chiqishda kirish chekini skanerlash: chek skaner ostiga kiradi, lazer o'tadi, keyin natija
import { useEffect, useState } from 'react';
import { api, money, time, duration, calcFee } from './api';
import { QR } from './Ticket';

const SCAN_MS = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1700;

function beep(ok) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1320 : 330;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
  } catch {
    // ovoz bo'lmasa ham ishlayveradi
  }
}

export default function ScanModal({ code, onClose, onExit }) {
  const [phase, setPhase] = useState('scan');
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exitError, setExitError] = useState('');

  useEffect(() => {
    let alive = true;
    const wait = new Promise((r) => setTimeout(r, SCAN_MS));
    Promise.all([api(`/tickets/${encodeURIComponent(code)}`), wait]).then(
      ([t]) => alive && (setTicket({ ...t, stay: Date.now() - new Date(t.entered_at) }), setPhase('done'), beep(t.active)),
      (e) => wait.then(() => alive && (setError(e.message), setPhase('done'), beep(false)))
    );
    return () => { alive = false; };
  }, [code]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [confirmExpel, setConfirmExpel] = useState(false);

  // paid = false: mijoz to'lay olmadi, qorovul haydab chiqaradi, summa qarz bo'lib yoziladi
  async function exit(paid = true) {
    setBusy(true);
    try {
      onExit(await api(`/${paid ? 'exit' : 'expel'}/${ticket.spot_id}`, { method: 'PUT' }));
    } catch (e) {
      setExitError(e.message);
      setBusy(false);
    }
  }

  const stay = ticket?.stay ?? 0;

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Chekni skanerlash">
      <div className="scanner" onClick={(e) => e.stopPropagation()}>
        <div className={`scan-bed ${phase}${phase === 'done' && !ticket?.active ? ' bad' : ''}`}>
          <div className="scan-ticket">
            <QR code={code} size={120} />
            <span className="mono">{code}</span>
          </div>
          <div className="scan-head"><i className="laser" /></div>
        </div>

        {phase === 'scan' ? (
          <p className="scan-msg" role="status">Skanerlanmoqda…</p>
        ) : error ? (
          <div className="scan-result bad" role="alert"><h2>Chek topilmadi</h2><p>{error}</p></div>
        ) : ticket.active ? (
          <div className="scan-result ok">
            <h2>Chek faol</h2>
            <p className="plate lg">{ticket.plate}</p>
            <dl className="facts">
              <dt>Joy</dt><dd>{ticket.label}{ticket.is_premium ? ' (VIP)' : ''}</dd>
              <dt>Kirdi</dt><dd>{time(ticket.entered_at)}</dd>
              <dt>Turdi</dt><dd>{duration(stay)}</dd>
              <dt>To'lov</dt><dd className="price">{ticket.disabled_driver ? 'Bepul (nogironlar uchun)' : money(calcFee(stay, ticket.tariff, ticket.is_premium))}</dd>
            </dl>
            <button className="btn danger big" onClick={() => exit(true)} disabled={busy} autoFocus>To'landi: chiqarish va chek berish</button>
            {confirmExpel ? (
              <div className="expel-confirm">
                <p>{money(calcFee(stay, ticket.tariff, ticket.is_premium))} qarz bo'lib yoziladi. Haydab chiqarasizmi?</p>
                <button className="btn ghost sm" onClick={() => setConfirmExpel(false)}>Yo'q</button>
                <button className="btn sm danger" onClick={() => exit(false)} disabled={busy}>Ha, haydab chiqarish</button>
              </div>
            ) : (
              <button className="btn ghost danger-text" onClick={() => setConfirmExpel(true)}>To'lay olmadi — haydab chiqarish</button>
            )}
            {exitError && <p className="error" role="alert">{exitError}</p>}
          </div>
        ) : (
          <div className="scan-result bad" role="alert">
            <h2>Chek faol emas</h2>
            <p>{ticket.plate} {time(ticket.left_at)} da chiqib ketgan, {ticket.paid ? `${money(ticket.fee)} to'langan` : `to'lamagan, qarzi ${money(ticket.fee)}`}. Chek: {ticket.receipt_no}</p>
          </div>
        )}
        <button className="btn ghost" onClick={onClose}>Yopish</button>
      </div>
    </div>
  );
}
