// Original 64-point Gauss-Legendre integration of the standard-normal density.
const N = 64,
  X = [],
  W = [];
for (let i = 0; i < N / 2; i++) {
  let z = Math.cos((Math.PI * (i + 0.75)) / (N + 0.5)),
    der = 0;
  for (let k = 0; k < 30; k++) {
    let a = 1,
      b = z;
    for (let j = 2; j <= N; j++) {
      const t = ((2 * j - 1) * z * b - (j - 1) * a) / j;
      a = b;
      b = t;
    }
    der = (N * (z * b - a)) / (z * z - 1);
    const step = b / der;
    z -= step;
    if (Math.abs(step) < 2e-16) break;
  }
  let a = 1,
    b = z;
  for (let j = 2; j <= N; j++) {
    const t = ((2 * j - 1) * z * b - (j - 1) * a) / j;
    a = b;
    b = t;
  }
  der = (N * (z * b - a)) / (z * z - 1);
  X[i] = -z;
  X[N - 1 - i] = z;
  W[i] = W[N - 1 - i] = 2 / ((1 - z * z) * der * der);
}
export const density = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
export function cdf(x) {
  if (!Number.isFinite(x)) throw Error("Finite normal argument required.");
  if (x === 0) return 0.5;
  const a = Math.abs(x);
  if (a >= 12) return x < 0 ? 0 : 1;
  const mid = (a + 12) / 2,
    half = (12 - a) / 2;
  let sum = 0;
  for (let i = 0; i < N; i++) sum += W[i] * density(mid + half * X[i]);
  const tail = half * sum;
  return x < 0 ? tail : 1 - tail;
}
export const BASE = 252,
  SAMPLES = 128,
  RATE = 0.02,
  FREQUENCIES = Object.freeze([1, 4, 12, 28, 84, 252]);
export const DEFAULT = Object.freeze({
  pathSigma: 0.2,
  hedgeSigma: 0.2,
  bps: 5,
  intervals: 28,
  seed: 2375,
  kind: "call",
});
export function validate(p) {
  if (
    !p ||
    !Number.isFinite(p.pathSigma) ||
    p.pathSigma < 0.1 ||
    p.pathSigma > 0.5 ||
    !Number.isFinite(p.hedgeSigma) ||
    p.hedgeSigma < 0.1 ||
    p.hedgeSigma > 0.5 ||
    !Number.isFinite(p.bps) ||
    p.bps < 0 ||
    p.bps > 25 ||
    !Number.isInteger(p.seed) ||
    p.seed < 1 ||
    p.seed > 999999 ||
    !FREQUENCIES.includes(p.intervals) ||
    !["call", "put"].includes(p.kind)
  )
    throw Error(
      "Volatilities10..50%, costs0..25bps, integer seed1..999999, listed intervals and call/put required.",
    );
}
export function quote(s, tau, sigma, kind) {
  if (
    !Number.isFinite(s) ||
    s <= 0 ||
    !Number.isFinite(tau) ||
    tau < 0 ||
    tau > 1 ||
    !Number.isFinite(sigma) ||
    sigma < 0.1 ||
    sigma > 0.5 ||
    !["call", "put"].includes(kind)
  )
    throw Error("Invalid quote domain.");
  if (tau === 0)
    return {
      price: Math.max(kind === "call" ? s - 100 : 100 - s, 0),
      delta: 0,
    };
  const v = sigma * Math.sqrt(tau),
    d1 = (Math.log(s / 100) + (RATE + 0.5 * sigma * sigma) * tau) / v,
    d2 = d1 - v,
    b = 100 * Math.exp(-RATE * tau),
    delta = cdf(d1);
  return kind === "call"
    ? { price: s * cdf(d1) - b * cdf(d2), delta }
    : { price: b * cdf(-d2) - s * cdf(-d1), delta: delta - 1 };
}
export function path(p, stream = 0) {
  validate(p);
  if (!Number.isInteger(stream) || stream < 0 || stream > SAMPLES)
    throw Error("stream0..128 integer");
  let state = (p.seed + 104729 * stream) >>> 0;
  const s = [100];
  for (let i = 1; i <= BASE; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const u = (state + 0.5) / 4294967296;
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const v = (state + 0.5) / 4294967296;
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    s.push(
      s[i - 1] *
        Math.exp(
          (RATE - 0.5 * p.pathSigma * p.pathSigma) / BASE +
            (p.pathSigma / Math.sqrt(BASE)) * z,
        ),
    );
  }
  return s;
}
export function hedge(p, s) {
  validate(p);
  if (
    !Array.isArray(s) ||
    s.length !== BASE + 1 ||
    s[0] !== 100 ||
    s.some((v) => !Number.isFinite(v) || v <= 0)
  )
    throw Error("253 positive finite path values starting100 required.");
  const stride = BASE / p.intervals,
    rows = [],
    premium = quote(100, 1, p.hedgeSigma, p.kind).price;
  let cash = premium,
    grossCash = premium,
    old = 0,
    fees = 0,
    fv = 0;
  for (let k = 0; k <= p.intervals; k++) {
    const step = k * stride,
      t = step / BASE,
      growth = k === 0 ? 1 : Math.exp((RATE * stride) / BASE),
      accrued = cash * growth;
    grossCash *= growth;
    const q = quote(s[step], 1 - t, p.hedgeSigma, p.kind),
      delta = k === p.intervals ? 0 : q.delta,
      trade = delta - old,
      fee = (Math.abs(trade) * s[step] * p.bps) / 10000;
    cash = accrued - trade * s[step] - fee;
    grossCash -= trade * s[step];
    fees += fee;
    fv += fee * Math.exp(RATE * (1 - t));
    const equity = cash + delta * s[step];
    rows.push({
      step,
      time: t,
      spot: s[step],
      accrued,
      previousDelta: old,
      delta,
      trade,
      fee,
      cash,
      mark: q.price,
      equity,
      error: equity - q.price,
    });
    old = delta;
  }
  const payoff = quote(s[BASE], 0, p.hedgeSigma, p.kind).price;
  return {
    premium,
    gross: grossCash - payoff,
    net: cash - payoff,
    nominalFees: fees,
    financedFees: fv,
    rows,
  };
}
export function compare(p) {
  validate(p);
  const paths = Array.from({ length: SAMPLES }, (_, i) => path(p, i + 1));
  return FREQUENCIES.map((intervals) => {
    const errors = [],
      r = paths.map((s) => hedge({ ...p, intervals }, s));
    for (const a of r) errors.push(a.net);
    const mean = errors.reduce((a, b) => a + b, 0) / SAMPLES;
    return {
      intervals,
      mean,
      sd: Math.sqrt(errors.reduce((a, b) => a + (b - mean) ** 2, 0) / SAMPLES),
      rmse: Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / SAMPLES),
      grossRmse: Math.sqrt(
        r.reduce((a, b) => a + b.gross * b.gross, 0) / SAMPLES,
      ),
      meanFees: r.reduce((a, b) => a + b.nominalFees, 0) / SAMPLES,
      errors,
    };
  });
}
