// Chek: termoprinter tirqishidan qog'oz chiqqandek pastga "chop etiladi"
import { useEffect } from 'react';
import { money, dateTime, duration } from './api';

export default function Receipt({ receipt: r, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ms = new Date(r.left_at) - new Date(r.entered_at);
  const hours = r.hours || Math.max(1, Math.ceil(ms / 3600000));
  // Soatma-soat taqsimot faqat chiqish paytida (tarif ma'lum bo'lganda)
  const rows = r.tariff ? Array.from({ length: Math.min(hours, 24) }, (_, i) => r.tariff.base_hour + i * r.tariff.step_hour) : [];

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Chek">
      <div className="printer" onClick={(e) => e.stopPropagation()}>
        <div className="printer-slot" />
        <div className="paper-clip">
          <article className="paper" id="print-receipt">
            <header>
              <b>AvtoStoyanka</b>
              <small>Toshkent, 24/7 qo'riqlanadi</small>
            </header>
            <p className="r-no">{r.receipt_no}</p>
            <p className="r-plate">{r.plate}</p>
            <dl>
              <dt>Joy</dt><dd>{r.label}{r.is_premium ? ' (Premium)' : ''}</dd>
              <dt>Kirdi</dt><dd>{dateTime(r.entered_at)}</dd>
              <dt>Chiqdi</dt><dd>{dateTime(r.left_at)}</dd>
              <dt>Turdi</dt><dd>{duration(ms)}</dd>
            </dl>
            {rows.length > 0 && (
              <ol className="r-hours">
                {rows.map((fee, i) => (
                  <li key={i}><span>{i + 1}-soat</span><span>{money(fee)}</span></li>
                ))}
                {hours > rows.length && <li><span>…</span><span /></li>}
                {r.is_premium && <li><span>Premium</span><span>× {r.tariff.premium_mult}</span></li>}
              </ol>
            )}
            <p className="r-total"><span>Jami</span><span>{money(r.fee)}</span></p>
            <p className="r-guard">Qorovul: {r.guard_out_name || '—'}</p>
            <p className="r-thanks">Yo'lingiz bexatar bo'lsin</p>
          </article>
        </div>
        <div className="printer-actions">
          <button className="btn" onClick={() => window.print()}>Chop etish</button>
          <button className="btn ghost" onClick={onClose} autoFocus>Yopish</button>
        </div>
      </div>
    </div>
  );
}
