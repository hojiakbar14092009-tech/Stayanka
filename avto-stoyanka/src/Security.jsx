// Xavfsizlik: topilgan o'g'irlangan mashinalar, qidiruvdagi raqamlar va tekshiruvchilar.
// Qorovul ko'radi; admin raqam qo'shadi, tekshiruvchi qo'shadi va smenaga qo'yadi (smenada ko'pi bilan 2 kishi).
import { useState } from 'react';
import { api, dateTime } from './api';

export default function Security({ security, reload, admin }) {
  const { wanted, found, inspectors } = security;
  const [plate, setPlate] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
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
  const onShift = inspectors.filter((i) => i.on_shift).length;

  return (
    <div className="security">
      <section className="card stolen-card">
        <h2>Topilgan o'g'irlangan mashinalar <span className="muted">{found.length} ta</span></h2>
        {found.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Raqam</th><th>Joy</th><th>Topdi</th><th>Qachon</th>{admin && <th />}</tr></thead>
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
        ) : <p className="muted">Hozircha topilmadi. Tekshiruvchilar stoyankani aylanib, har bir mashina raqamini qidiruvdagi ro'yxat bilan solishtiradi.</p>}
      </section>

      <div className="panels two">
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

        <section className="card">
          <h2>Tekshiruvchilar <span className="muted">smenada {onShift} / 2</span></h2>
          <ul className="inspector-list">
            {inspectors.map((i) => (
              <li key={i.id}>
                <span>{i.full_name}</span>
                {admin ? (
                  <button className={'btn sm ' + (i.on_shift ? 'primary' : 'ghost')} aria-pressed={i.on_shift}
                    onClick={() => run(() => api('/admin/inspectors/' + i.id, { method: 'PUT', body: { on_shift: !i.on_shift } }), i.on_shift ? 'Smenadan chiqarildi' : "Smenaga qo'yildi")}>
                    {i.on_shift ? 'Smenada' : 'Smenaga qo\'yish'}
                  </button>
                ) : <span className={'shift-tag' + (i.on_shift ? ' on' : '')}>{i.on_shift ? 'smenada' : 'dam olishda'}</span>}
              </li>
            ))}
          </ul>
          {admin && (
            <form className="row-form" onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api('/admin/inspectors', { method: 'POST', body: { full_name: name } }), "Tekshiruvchi qo'shildi")) setName('');
            }}>
              <input className="input" placeholder="Ism va familiya" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} aria-label="Yangi tekshiruvchi" />
              <button className="btn primary">Tekshiruvchi qo'shish</button>
            </form>
          )}
        </section>
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  );
}
