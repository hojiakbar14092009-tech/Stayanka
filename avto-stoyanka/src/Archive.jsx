// Cheklar arxivi: raqam yoki chek raqami bo'yicha qidiruv, sana oralig'i, qayta ko'rish
import { useEffect, useState } from 'react';
import { api, money, dateTime } from './api';
import Receipt from './Receipt';

export default function Archive() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams({ q, from, to });
    const t = setTimeout(() => api(`/receipts?${params}`).then((l) => { setList(l); setError(''); }, (e) => setError(e.message)), 250);
    return () => clearTimeout(t);
  }, [q, from, to]);

  const total = list.reduce((s, r) => s + r.fee, 0);

  return (
    <section className="archive">
      <div className="archive-filters">
        <input className="input" placeholder="Mashina, chek yoki kirish cheki raqami" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Qidiruv" />
        <label>Dan <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Gacha <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <p className="archive-sum">{list.length} ta chek, jami <b>{money(total)}</b></p>
      </div>
      {error && <p className="error">{error}</p>}
      {list.length === 0 ? (
        <p className="empty">Bu oraliqda chek yo'q. Sana yoki qidiruvni o'zgartiring.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Chek</th><th>Kirish cheki</th><th>Raqam</th><th>Joy</th><th>Kirdi</th><th>Chiqdi</th><th>Qorovul</th><th className="num">Summa</th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
                  <td className="mono">{r.receipt_no}</td>
                  <td className="mono muted">{r.ticket_no || '—'}</td>
                  <td><span className="plate sm">{r.plate}</span></td>
                  <td>{r.label}{r.is_premium && <span className="gold"> P+</span>}</td>
                  <td>{dateTime(r.entered_at)}</td>
                  <td>{dateTime(r.left_at)}</td>
                  <td>{r.guard_out_name}</td>
                  <td className={`num${r.paid === false ? ' unpaid' : ''}`}>{r.paid === false && <small>qarz </small>}{r.disabled_driver ? <small>♿ bepul</small> : money(r.fee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <Receipt receipt={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
