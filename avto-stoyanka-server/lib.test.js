import test from 'node:test';
import assert from 'node:assert/strict';
import { calcFee, makeToken, readToken, hashPassword, checkPassword } from './lib.js';

const T = { base_hour: 5000, step_hour: 1000, premium_hour: 30000 };
const H = 3600000;

test('narx har soat oshadi', () => {
  assert.equal(calcFee(0, T, false), 5000); // minimal 1 soat
  assert.equal(calcFee(H, T, false), 5000);
  assert.equal(calcFee(H + 1, T, false), 11000); // 5000 + 6000
  assert.equal(calcFee(3 * H, T, false), 18000);
  assert.equal(calcFee(H, T, true), 30000);
  assert.equal(calcFee(3 * H, T, true), 93000); // 30000 + 31000 + 32000
});

test('token va parol', () => {
  const t = makeToken({ id: 7, role: 'guard' });
  assert.equal(readToken(t).id, 7);
  assert.equal(readToken(t.slice(0, -2) + 'xx'), null);
  const h = hashPassword('qorovul1');
  assert.ok(checkPassword('qorovul1', h));
  assert.ok(!checkPassword('boshqa', h));
});

test('boshliq: xarajat va to\'lov sanasi', async () => {
  const { expenseFor, nextPayout } = await import('./boss.js');
  assert.equal(expenseFor({ period: 'month', amount: 3000000 }, 1, 0), 100000);
  assert.equal(expenseFor({ period: 'day', amount: 50000 }, 7, 0), 350000);
  assert.equal(expenseFor({ period: 'percent', amount: 4 }, 30, 1000000), 40000);
  const wed = new Date(2026, 10, 4); // chorshanba
  assert.equal(nextPayout('day', wed), '2026-11-05'); // ertaga
  assert.equal(nextPayout('week', wed), '2026-11-09'); // dushanba
  assert.equal(nextPayout('month', wed), '2026-12-01');
});
