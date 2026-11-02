// Parol, token va narx — tashqi kutubxonasiz (node:crypto)
import crypto from 'node:crypto';

const SECRET = process.env.TOKEN_SECRET || 'stoyanka-dev-secret';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // bitta smena

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

export function makeToken(user) {
  const data = Buffer.from(JSON.stringify({ id: user.id, role: user.role, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${data}.${sign(data)}`;
}

export function readToken(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig) return null;
  const expected = sign(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  return payload.exp > Date.now() ? payload : null;
}

// Har boshlangan soat avvalgisidan step_hour ga qimmat. Minimal 1 soat.
export function calcFee(ms, { base_hour, step_hour, premium_mult }, isPremium) {
  const h = Math.max(1, Math.ceil(ms / 3600000));
  const total = h * base_hour + (step_hour * h * (h - 1)) / 2;
  return Math.round(isPremium ? total * premium_mult : total);
}
