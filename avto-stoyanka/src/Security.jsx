// Xavfsizlik: kirish kamerasi aniqlagan o'g'irlangan mashinalar va qidiruvdagi raqamlar.
// Qorovul ko'radi; admin qidiruvga raqam qo'shadi va topilgan mashinani militsiyaga topshirilgan deb yopadi.
import { useState } from 'react';
import { api, dateTime } from './api';

export default function Security({ security, reload, admin }) {
  const { wanted, found } = security;
  const [plate, setPlate] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const run = async (fn, ok) => {
    try {
      await fn();
      setMsg(ok);
      await reload();
      return true;
    } catch (e) {
      setMsg(e.message);
      return false;
    }
  };

  return (
    <div className="security">
      <section className="card stolen-card">
        <h2>Topilgan o'g'irlangan mashinalar <span className="muted">{found.length} ta</span></h2>
        {found.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Raqam</th><th>Joy</th><th>Aniqladi</th><th>Qachon</th>{admin && <th />}</tr></thead>
              <tbody>
                {found.map((f) => (
                  <tr key={f.id}>
                    <td><span className="plate sm">{f.plate}</span></td>
                    <td>{f.spot_label}</td>
                    <td>{f.inspector}</td>
                    <td>{dateTime(f.found_at)}</td>
                    {admin && (
                      <td className="row-actions">
                        {f.open && <button className="btn ghost sm" onClick={() => run(() => api('/admin/stolen/' + f.id + '/handover', { method: 'POST' }), 'Mashina militsiyaga topshirildi, joy bo\'shadi')}>Militsiyaga topshirildi</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Hozircha topilmadi. Kirish kamerasi har bir mashina raqamini qidiruvdagi ro'yxat bilan solishtiradi.</p>}
      </section>

      <section className="card">
          <h2>Qidiruvdagi raqamlar <span className="muted">{wanted.length} ta</span></h2>
          <ul className="wanted-list">
            {wanted.map((w) => (
              <li key={w.plate}>
                <span className="plate sm">{w.plate}</span>
                <span className="muted">{w.note}</span>
                {admin && <button className="btn ghost sm danger-text" onClick={() => run(() => api('/admin/wanted/' + w.plate, { method: 'DELETE' }), "Ro'yxatdan olindi")}>Olib tashlash</button>}
              </li>
            ))}
          </ul>
          {admin && (
            <form className="row-form" onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api('/admin/wanted', { method: 'POST', body: { plate, note } }), "Qidiruvga qo'shildi")) {
                setPlate('');
                setNote('');
              }
            }}>
              <input className="input" placeholder="Raqam: 01 A 123 BC" value={plate} onChange={(e) => setPlate(e.target.value)} required aria-label="Qidiruvdagi raqam" />
              <input className="input" placeholder="Izoh, masalan IIV xabari" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Izoh" />
              <button className="btn primary">Qidiruvga qo'shish</button>
            </form>
          )}
        </section>

      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  );
}
