import assert from "node:assert/strict";
import {
  DEFAULT,
  quote,
  cdf,
  path,
  hedge,
  compare,
  FREQUENCIES,
} from "../web/src/model.js";
let count = 0;
const ok = (b) => {
    count++;
    assert(b);
  },
  close = (a, b, t = 1e-10) =>
    ok(Math.abs(a - b) <= t * Math.max(1, Math.abs(a), Math.abs(b)));
for (let j = 0; j < 180; j++) {
  const p = {
    ...DEFAULT,
    kind: j % 2 ? "put" : "call",
    pathSigma: 0.1 + (j % 5) * 0.1,
    hedgeSigma: 0.1 + (Math.floor(j / 5) % 5) * 0.1,
    bps: j % 26,
    intervals: FREQUENCIES[j % 6],
    seed: 1 + ((7919 * j) % 999999),
  };
  const s = path(p),
    r = hedge(p, s),
    zero = hedge({ ...p, bps: 0 }, s),
    more = hedge({ ...p, bps: 25 }, s);
  close(r.gross, zero.net);
  close(r.gross - r.net, r.financedFees);
  ok(more.net <= r.net + 1e-10);
  close(r.net, r.rows.at(-1).error);
  ok(r.rows.at(-1).delta === 0);
  for (const row of r.rows) {
    close(row.cash, row.accrued - row.trade * row.spot - row.fee);
    close(row.error, row.cash + row.delta * row.spot - row.mark);
    close(row.delta - row.previousDelta, row.trade);
    close(row.fee, (Math.abs(row.trade) * row.spot * p.bps) / 10000);
    ok(row.mark >= -1e-10);
    ok(Math.abs(row.delta) <= 1);
  }
  close(
    r.nominalFees,
    r.rows.reduce((a, b) => a + b.fee, 0),
  );
  const sampled = path({ ...p, intervals: FREQUENCIES[(j + 1) % 6] });
  for (let i = 0; i < s.length; i++) close(sampled[i], s[i], 0);
}
for (const [key, vals] of Object.entries({
  pathSigma: [NaN, Infinity, 0.099, 0.501],
  hedgeSigma: [NaN, Infinity, 0, 1],
  bps: [NaN, Infinity, -1, 26],
  intervals: [0, 2, 3, 4.5, 253, Infinity],
  seed: [0, -1, 1.5, 1000000, NaN, Infinity],
  kind: ["CALL", "straddle", null],
}))
  for (const v of vals) {
    assert.throws(() => path({ ...DEFAULT, [key]: v }));
    count++;
  }
for (const v of [
  null,
  [],
  [100],
  Array(253).fill(0),
  [101, ...Array(252).fill(100)],
  [100, ...Array(252).fill(NaN)],
]) {
  assert.throws(() => hedge(DEFAULT, v));
  count++;
}
for (const v of [-1, 0.5, 129, NaN]) {
  assert.throws(() => path(DEFAULT, v));
  count++;
}
// Flat, exponential-growth and large alternating deterministic paths break dependence on PRNG fixtures.
for (const s of [
  Array(253).fill(100),
  Array.from({ length: 253 }, (_, i) => 100 * Math.exp((0.02 * i) / 252)),
  Array.from({ length: 253 }, (_, i) => (i === 0 ? 100 : i % 2 ? 85 : 115)),
])
  for (const n of FREQUENCIES) {
    const p = { ...DEFAULT, intervals: n },
      r = hedge(p, s);
    close(r.net, r.gross - r.financedFees);
    if (n === 1) {
      const d = quote(100, 1, p.hedgeSigma, p.kind).delta;
      close(
        r.gross,
        (r.premium - 100 * d) * Math.exp(0.02) +
          d * s[252] -
          Math.max(s[252] - 100, 0),
      );
    }
  }
for (let i = -100; i <= 100; i++) close(cdf(i / 10) + cdf(-i / 10), 1, 1e-13);
for (let j = 0; j < 8; j++) {
  const p = {
      ...DEFAULT,
      seed: j + 1,
      bps: j * 3,
      kind: j % 2 ? "put" : "call",
    },
    a = compare(p),
    b = compare({ ...p, intervals: 252 });
  for (let i = 0; i < a.length; i++) {
    const s = a[i];
    for (const key of ["mean", "sd", "rmse", "grossRmse", "meanFees"])
      close(s[key], b[i][key], 0);
    close(s.rmse ** 2, s.mean ** 2 + s.sd ** 2);
    for (let k = 0; k < 128; k++)
      close(
        s.errors[k],
        hedge({ ...p, intervals: s.intervals }, path(p, k + 1)).net,
      );
  }
}
console.log(`${count} domain assertions passed`);
