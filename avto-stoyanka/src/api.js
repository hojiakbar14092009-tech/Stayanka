// Server bilan aloqa va umumiy yordamchilar
export const API = import.meta.env.VITE_API || 'http://localhost:3000/api';

export const getToken = () => localStorage.getItem('token');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    localStorage.removeItem('token');
    window.dispatchEvent(new Event('logout'));
  }
  if (!res.ok) throw new Error(data.error || "Server bilan aloqa yo'q");
  return data;
}

export const money = (n) => `${Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`;

export const time = (d) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const dateTime = (d) =>
  new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function duration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m < 60 ? `${m} daq` : `${Math.floor(m / 60)} soat ${m % 60} daq`;
}

// Server lib.js dagi calcFee bilan bir xil — jonli narxni ko'rsatish uchun
export function calcFee(ms, t, isPremium) {
  const h = Math.max(1, Math.ceil(ms / 3600000));
  return h * (isPremium ? t.premium_hour : t.base_hour) + (t.step_hour * h * (h - 1)) / 2;
}

// Raqamdan doimiy mashina rangi
const PAINTS = ['#c9ccd1', '#3b4a6b', '#8a2f2f', '#e6e3dc', '#4f5a52', '#1f2226', '#9a7b4f', '#5b6f8a'];
export function paintFor(plate = '') {
  let h = 0;
  for (const c of plate) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PAINTS[h % PAINTS.length];
}
