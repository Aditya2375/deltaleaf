import { spawnSync } from "node:child_process";
import {
  DEFAULT,
  path,
  hedge,
  compare,
  FREQUENCIES,
} from "../web/src/model.js";
let count = 0,
  max = 0;
function eq(a, b, m) {
  const d = Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
  max = Math.max(d, max);
  count++;
  if (!Number.isFinite(d) || d > 2e-10) throw Error(`${m}: ${a} vs ${b}`);
}
for (let j = 0; j < 24; j++) {
  const p = {
      ...DEFAULT,
      kind: j % 2 ? "put" : "call",
      pathSigma: [0.1, 0.2, 0.5][j % 3],
      hedgeSigma: [0.1, 0.3, 0.5][Math.floor(j / 3) % 3],
      bps: [0, 5, 25][j % 3],
      intervals: FREQUENCIES[j % 6],
      seed: [1, 2375, 999999][j % 3],
    },
    s = path(p),
    r = hedge(p, s),
    stats = compare(p);
  const c = spawnSync(
    process.env.JAVA || "java",
    [
      "-cp",
      "build/classes",
      "Dump",
      p.pathSigma,
      p.hedgeSigma,
      p.bps,
      p.intervals,
      p.seed,
      p.kind,
    ].map(String),
    { encoding: "utf8", maxBuffer: 8e6 },
  );
  if (c.status !== 0) throw Error(c.stderr);
  for (const line of c.stdout.trim().split("\n")) {
    const [tag, ...v] = line.split(","),
      a = v.map(Number);
    if (tag === "P") eq(a[1], s[a[0]], "path");
    if (tag === "R")
      Object.values(r)
        .slice(0, 5)
        .forEach((n, i) => eq(a[i], n, "summary"));
    if (tag === "L") {
      const row = r.rows[a[0] / (252 / p.intervals)];
      Object.values(row).forEach((n, i) => eq(a[i], n, "rowfield"));
    }
    if (tag === "S") {
      const st = stats.find((s) => s.intervals === a[0]);
      Object.values(st)
        .slice(0, 6)
        .forEach((n, i) => eq(a[i], n, "stats"));
    }
    if (tag === "E")
      eq(
        a[2],
        stats.find((s) => s.intervals === a[0]).errors[a[1]],
        "everycomparisonpath",
      );
  }
}
console.log(`${count} Java/JS comparisons passed, max scaled ${max}`);
