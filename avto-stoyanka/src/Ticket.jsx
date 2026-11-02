// Kirish cheki: har mashinaga o'ziga xos QR kod. Mashina ichkarida ekan — FAOL, chiqqach — FAOL EMAS.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { money, dateTime } from './api';

export function QR({ code, size = 168 }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg);
  }, [code]);
  // svg qrcode kutubxonasidan keladi, foydalanuvchi matni emas
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function Ticket({ ticket: t, onClose, closeLabel = 'Yopish' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !t.handover && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, t.handover]);

  // Darvozadagi mashina cheki tasodifan yopilmasin: faqat tugma bilan (chek berildi)
  const hour = t.tariff && (t.is_premium ? t.tariff.premium_hour : t.tariff.base_hour);

  return (
    <div className="overlay" onClick={t.handover ? undefined : onClose} role="dialog" aria-modal="true" aria-label="Kirish cheki">
      <div className="printer" onClick={(e) => e.stopPropagation()}>
        <div className="printer-slot" />
        <div className="paper-clip">
          <article className="paper ticket" id="print-receipt">
            <header>
              <b>AvtoStoyanka</b>
              <small>Kirish cheki. Chiqishda ko'rsating</small>
            </header>
            <p className={`t-status ${t.active ? 'on' : 'off'}`}>{t.active ? 'Faol' : 'Faol emas'}</p>
            {t.disabled_driver && <p className="t-free">♿ Nogironlar uchun bepul</p>}
            {t.debt > 0 && <p className="t-debt">Oldingi qarz: {money(t.debt)}</p>}
            <div className="t-spot">
              <small>Joyingiz</small>
              <b>{t.label}</b>
              {t.is_premium && <em>Premium, yopiq</em>}
            </div>
            <p className="r-plate">{t.plate}</p>
            <QR code={t.ticket_no} />
            <p className="r-no">{t.ticket_no}</p>
            <dl>
              <dt>Kirdi</dt><dd>{dateTime(t.entered_at)}</dd>
              {hour && <><dt>1-soat</dt><dd>{money(hour)}</dd></>}
              {t.tariff && <><dt>Keyingi har soat</dt><dd>+{money(t.tariff.step_hour)}</dd></>}
              <dt>Qorovul</dt><dd>{t.guard_in_name || '—'}</dd>
            </dl>
            <p className="r-thanks">Chekni yo'qotmang</p>
          </article>
        </div>
        <div className="printer-actions">
          <button className="btn" onClick={() => window.print()}>Chop etish</button>
          <button className={t.handover ? 'btn primary' : 'btn ghost'} onClick={onClose} autoFocus>{closeLabel}</button>
        </div>
      </div>
    </div>
  );
}
