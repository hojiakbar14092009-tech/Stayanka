import test from 'node:test';
import assert from 'node:assert/strict';
import { calcFee, makeToken, readToken, hashPassword, checkPassword } from './lib.js';

const T = { base_hour: 5000, step_hour: 1000, premium_mult: 2 };
const H = 3600000;

test('narx har soat oshadi', () => {
  assert.equal(calcFee(0, T, false), 5000); // minimal 1 soat
  assert.equal(calcFee(H, T, false), 5000);
  assert.equal(calcFee(H + 1, T, false), 11000); // 5000 + 6000
  assert.equal(calcFee(3 * H, T, false), 18000);
  assert.equal(calcFee(3 * H, T, true), 36000);
});

test('token va parol', () => {
  const t = makeToken({ id: 7, role: 'guard' });
  assert.equal(readToken(t).id, 7);
  assert.equal(readToken(t.slice(0, -2) + 'xx'), null);
  const h = hashPassword('qorovul1');
  assert.ok(checkPassword('qorovul1', h));
  assert.ok(!checkPassword('boshqa', h));
});
