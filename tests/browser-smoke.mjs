import { path, hedge, compare, DEFAULT } from "../web/src/model.js";
import { spawn } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  rmSync,
  mkdtempSync,
} from "node:fs";

const HTTP_PORT = 8990;
const CDP_PORT = 9391;
const SHOTS = process.env.SMOKE_SHOTS === "1";
const root = new URL("..", import.meta.url).pathname;

const profile = mkdtempSync("/tmp/deltaleaf-chrome-");
const server = spawn(
  "python3",
  [
    "-m",
    "http.server",
    String(HTTP_PORT),
    "--bind",
    "127.0.0.1",
    "--directory",
    `${root}docs`,
  ],
  { stdio: "ignore", detached: true },
);
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore", detached: true },
);

const cleanup = async (code) => {
  for (const child of [chrome, server]) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  await Promise.all(
    [chrome, server].map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((r) => child.once("exit", r)),
    ),
  );
  rmSync(profile, { recursive: true, force: true });
  process.exit(code);
};
const timeout = setTimeout(() => {
  console.error("smoke: timeout");
  cleanup(1);
}, 90000);
process.on("SIGINT", () => cleanup(2));
process.on("uncaughtException", (e) => {
  console.error(e);
  cleanup(1);
});
process.on("unhandledRejection", (e) => {
  console.error(e);
  cleanup(1);
});

async function waitFor(fn, label, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() - start > timeoutMs)
      throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(
    `${ok ? "ok" : "NOT OK"} - ${name}${detail ? " - " + detail : ""}`,
  );
};

await waitFor(
  async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok,
  "chrome devtools",
);
const target = await (
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/new`, { method: "PUT" })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let mid = 0;
const rpcPending = new Map();
const consoleErrors = [];
const requests = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === "Network.requestWillBeSent")
    requests.push(msg.params.request.url);
  if (msg.id && rpcPending.has(msg.id)) {
    rpcPending.get(msg.id)(msg);
    rpcPending.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown")
    consoleErrors.push(
      msg.params.exceptionDetails?.exception?.description ?? "page exception",
    );
};
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++mid;
    rpcPending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const res = await cdp("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.result?.exceptionDetails)
    throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
};
const shot = async (name) => {
  if (!SHOTS) return;
  await new Promise((r) => setTimeout(r, 900));
  const metrics = await cdp("Page.getLayoutMetrics");
  const size = metrics.result.cssContentSize;
  const r = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
  });
  writeFileSync(
    `${root}smoke-${name}.png`,
    Buffer.from(r.result.data, "base64"),
  );
};

await cdp("Runtime.enable");
await cdp("Network.enable");
await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
const url = process.env.SMOKE_URL || `http://127.0.0.1:${HTTP_PORT}/`;
await cdp("Page.navigate", { url });
await waitFor(
  async () =>
    await evaluate(`document.querySelectorAll('#ledger tbody tr').length===29`),
  "rendered",
);
const input = (id, v) =>
    evaluate(
      `document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(String(v))};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('input',{bubbles:true}));true`,
    ),
  submit = () =>
    evaluate(
      `document.getElementById('controls').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));true`,
    ),
  text = (id) =>
    evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`),
  click = (s) =>
    evaluate(`document.querySelector(${JSON.stringify(s)}).click();true`);
const snap = () =>
  evaluate(
    `({audit:[...document.querySelectorAll('#audit dd')].map(x=>x.textContent),ledger:[...document.querySelectorAll('#ledger tbody tr')].map(r=>[...r.cells].map(x=>x.textContent)),comparison:[...document.querySelectorAll('#comparison tbody tr')].map(r=>[...r.cells].map(x=>x.textContent)),row:document.getElementById('rownote').textContent,equation:document.getElementById('equation').textContent,charts:['spotChart','errorChart','compareChart'].map(id=>({width:document.getElementById(id).getBoundingClientRect().width,points:[...document.querySelectorAll('#'+id+' polyline')].map(x=>x.getAttribute('points')),selected:[...document.querySelectorAll('#'+id+' [data-selected]')].map(x=>[+x.getAttribute('cx'),+x.getAttribute('cy')])}))})`,
  );
const f = (n) => (Math.abs(n) < 0.0000005 ? "0.000000" : n.toFixed(6)),
  near = (a, b) => Math.abs(a - b) < 1e-6;
async function verify(p, event, label) {
  const s = path(p),
    r = hedge(p, s),
    st = compare(p),
    v = await snap(),
    row = r.rows[event];
  check(
    label + " audit11",
    JSON.stringify(v.audit) ===
      JSON.stringify([
        String(row.step),
        ...[
          "spot",
          "accrued",
          "previousDelta",
          "delta",
          "trade",
          "fee",
          "cash",
          "mark",
          "equity",
          "error",
        ].map((k) => f(row[k])),
      ]),
  );
  check(
    label + " rowlabel",
    v.row.includes(`event ${event}/${p.intervals}`) &&
      v.row.includes(
        event === 0
          ? "opening"
          : event === p.intervals
            ? "liquidation"
            : "rebalance",
      ),
  );
  check(
    label + " equation",
    v.equation.includes(
      `Cash ${f(row.cash)} = accrued ${f(row.accrued)} − trade ${f(row.trade)} × spot ${f(row.spot)} − fee ${f(row.fee)}`,
    ) && v.equation.includes(`Residual ${f(row.error)}`),
  );
  check(
    label + " allLedgerFields",
    v.ledger.length === r.rows.length &&
      v.ledger.every(
        (a, i) =>
          JSON.stringify(a) ===
          JSON.stringify([
            String(r.rows[i].step),
            ...[
              "spot",
              "accrued",
              "previousDelta",
              "delta",
              "trade",
              "fee",
              "cash",
              "mark",
              "equity",
              "error",
            ].map((k) => f(r.rows[i][k])),
          ]),
      ),
  );
  check(
    label + " allComparison36cells",
    v.comparison.length === 6 &&
      v.comparison.every(
        (a, i) =>
          JSON.stringify(a) ===
          JSON.stringify([
            String(st[i].intervals),
            ...["grossRmse", "rmse", "mean", "sd", "meanFees"].map((k) =>
              f(st[i][k]),
            ),
          ]),
      ),
  );
  check(label + " headlinePremium", (await text("premium")) === f(r.premium));
  check(label + " headlineGross", (await text("gross")) === f(r.gross));
  check(label + " headlineNet", (await text("net")) === f(r.net));
  check(
    label + " financedAndNominal",
    (await text("financed")) === f(r.financedFees) &&
      (await text("nominal")).includes(f(r.nominalFees)),
  );
  const sets = [
    [[...s]],
    [[...r.rows.map((r) => r.error)]],
    [st.map((a) => a.grossRmse), st.map((a) => a.rmse)],
  ];
  for (let c = 0; c < 3; c++) {
    const chart = v.charts[c],
      series = sets[c],
      all = series.flat(),
      lo = Math.min(...all, c ? 0 : Infinity),
      hi = Math.max(...all, c ? 0 : -Infinity),
      pad = Math.max((hi - lo) * 0.1, 0.1),
      min = lo - pad,
      max = hi + pad,
      w = Math.max(270, chart.width),
      bottom = (c === 2 ? 250 : 230) - 30,
      x = (i, len) => 42 + ((w - 54) * i) / (len - 1),
      y = (z) => bottom - ((bottom - 22) * (z - min)) / (max - min);
    check(
      label + " everyChartPoint" + c,
      chart.points.length === series.length &&
        chart.points.every((p, i) => {
          const points = p.split(" ").map((s) => s.split(",").map(Number));
          return (
            points.length === series[i].length &&
            points.every(
              ([a, b], j) =>
                near(a, x(j, points.length)) && near(b, y(series[i][j])),
            )
          );
        }),
    );
    if (c === 1)
      check(
        label + " selectedMarker",
        chart.selected.length === 1 &&
          near(chart.selected[0][0], x(event, r.rows.length)) &&
          near(chart.selected[0][1], y(row.error)),
      );
  }
}
await verify(DEFAULT, 0, "default");
await shot("default");
for (const i of [1, 14, 27, 28]) {
  await input("event", i);
  await verify(DEFAULT, i, "event" + i);
}
const old = await snap();
for (const [key, bad] of [
  ["seed", ""],
  ["seed", 1.5],
  ["seed", 1000000],
  ["bps", 26],
  ["pathSigma", 9],
  ["hedgeSigma", 51],
]) {
  await input(key, bad);
  await submit();
  check(
    key + bad + " invalidRetains",
    JSON.stringify((await snap()).audit) === JSON.stringify(old.audit) &&
      (await text("status")).includes("retained"),
  );
  for (const k of ["pathSigma", "hedgeSigma", "bps", "seed"])
    await input(
      k,
      ["pathSigma", "hedgeSigma"].includes(k) ? DEFAULT[k] * 100 : DEFAULT[k],
    );
}
await input("bps", 6);
check("dirtyStatus", (await text("status")).includes("UNAPPLIED"));
await cdp("Emulation.setDeviceMetricsOverride", {
  width: 1000,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});
await evaluate("new Promise(r=>setTimeout(r,120))");
check(
  "dirtyResizeRetains",
  JSON.stringify((await snap()).audit) === JSON.stringify(old.audit),
);
const cases = [
  {
    ...DEFAULT,
    kind: "put",
    pathSigma: 0.1,
    hedgeSigma: 0.5,
    bps: 25,
    intervals: 1,
    seed: 999999,
  },
  {
    ...DEFAULT,
    pathSigma: 0.5,
    hedgeSigma: 0.1,
    bps: 0,
    intervals: 252,
    seed: 1,
  },
  {
    ...DEFAULT,
    kind: "put",
    pathSigma: 0.5,
    hedgeSigma: 0.5,
    bps: 25,
    intervals: 84,
    seed: 22222,
  },
];
for (let j = 0; j < cases.length; j++) {
  const p = cases[j],
    previousEvent = +(await evaluate(`document.getElementById('event').value`));
  for (const k of [
    "kind",
    "pathSigma",
    "hedgeSigma",
    "bps",
    "intervals",
    "seed",
  ])
    await input(k, ["pathSigma", "hedgeSigma"].includes(k) ? p[k] * 100 : p[k]);
  await submit();
  const ev = Math.min(previousEvent, p.intervals);
  check(
    "eventClamp" + j,
    +(await evaluate(`document.getElementById('event').value`)) === ev,
  );
  await verify(p, ev, "scenario" + j);
  await input("event", p.intervals);
  await verify(p, p.intervals, "liquidation" + j);
  await shot("scenario" + j);
}
for (const k of ["kind", "pathSigma", "hedgeSigma", "bps", "intervals", "seed"])
  await input(
    k,
    ["pathSigma", "hedgeSigma"].includes(k) ? DEFAULT[k] * 100 : DEFAULT[k],
  );
await submit();
await input("event", 14);
for (const width of [768, 390, 360, 320]) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate("new Promise(r=>setTimeout(r,120))");
  const b = await evaluate(
    `({doc:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('input,select,form button,.metrics strong,.audit dd,svg')].map(e=>e.getBoundingClientRect().toJSON())})`,
  );
  check(
    "width" + width + " noOverflow",
    b.doc <= width &&
      b.controls.every((r) => r.left >= 0 && r.right <= width + 0.5),
  );
  await verify(DEFAULT, 14, "width" + width);
  if (width === 320) {
    await shot("mobile-plots");
    await click("summary");
    await shot("mobile-ledger");
    const d = await evaluate(
      `({h:document.querySelector('.ledger').clientHeight,sh:document.querySelector('.ledger').scrollHeight,w:document.querySelector('.ledger').clientWidth,sw:document.querySelector('.ledger').scrollWidth})`,
    );
    check("ledgerBothAxes", d.h <= 420 && d.sh > d.h && d.sw > d.w);
    await evaluate(
      `document.querySelector('.ledger').scrollLeft=500;document.querySelector('.ledger').scrollTop=100;true`,
    );
    check(
      "ledgerScrollWorks",
      await evaluate(
        `document.querySelector('.ledger').scrollLeft>0&&document.querySelector('.ledger').scrollTop>0`,
      ),
    );
  }
}
check("noErrors", consoleErrors.length === 0, consoleErrors.join(";"));
const origin = new URL(url).origin;
check(
  "noOffOriginRequests",
  requests.every((u) => u.startsWith(origin) || u === "about:blank"),
);
check(
  "noStorage",
  await evaluate(
    `localStorage.length===0&&sessionStorage.length===0&&!document.cookie`,
  ),
);
check(
  "CSP",
  await evaluate(
    `document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("img-src 'self';")&&document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("connect-src 'none'")`,
  ),
);
writeFileSync(root + "browser-checks.json", JSON.stringify(checks, null, 2));
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length} Chrome checks, ${failed.length} failures`);
clearTimeout(timeout);
await cleanup(failed.length ? 1 : 0);
