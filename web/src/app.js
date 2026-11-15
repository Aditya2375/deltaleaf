import { DEFAULT, validate, path, hedge, compare } from "./model.js";
const $ = (id) => document.getElementById(id),
  NS = "http://www.w3.org/2000/svg",
  fmt = (n) => (Math.abs(n) < 0.0000005 ? "0.000000" : n.toFixed(6)),
  keys = ["kind", "pathSigma", "hedgeSigma", "bps", "intervals", "seed"];
let applied = { ...DEFAULT },
  result,
  prices,
  stats;
function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function svg(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}
function chart(
  id,
  series,
  { categorical = false, labels = [], zero = false, selected = null } = {},
) {
  const el = $(id),
    w = Math.max(270, el.getBoundingClientRect().width),
    h = id === "compareChart" ? 250 : 230,
    L = 42,
    R = w - 12,
    T = 22,
    B = h - 30;
  el.setAttribute("viewBox", `0 0 ${w} ${h}`);
  el.replaceChildren();
  const values = series.flatMap((s) => s.values),
    lo = Math.min(...values, zero ? 0 : Infinity),
    hi = Math.max(...values, zero ? 0 : -Infinity),
    pad = Math.max((hi - lo) * 0.1, 0.1),
    min = lo - pad,
    max = hi + pad,
    x = (i, len) => L + ((R - L) * i) / (len - 1),
    y = (v) => B - ((B - T) * (v - min)) / (max - min);
  for (let i = 0; i < 3; i++) {
    const v = min + ((max - min) * i) / 2;
    el.append(
      svg("line", { x1: L, y1: y(v), x2: R, y2: y(v) }),
      svg(
        "text",
        { x: L - 4, y: y(v) + 4, "text-anchor": "end" },
        v.toFixed(2),
      ),
    );
  }
  if (zero)
    el.append(svg("line", { class: "zero", x1: L, x2: R, y1: y(0), y2: y(0) }));
  for (let si = 0; si < series.length; si++) {
    const a = series[si],
      cl = si ? "series secondary" : "series";
    el.append(
      svg("polyline", {
        class: cl,
        points: a.values
          .map((v, i) => `${x(i, a.values.length)},${y(v)}`)
          .join(" "),
        "data-series": si,
      }),
    );
    if (categorical)
      for (let i = 0; i < a.values.length; i++)
        el.append(
          svg("circle", {
            cx: x(i, a.values.length),
            cy: y(a.values[i]),
            r: 2,
            class: si ? "secondary-dot" : "primary-dot",
            "data-series": si,
            "data-index": i,
          }),
        );
  }
  const ticks = categorical ? labels : [0, 0.5, 1];
  for (let i = 0; i < ticks.length; i++) {
    const pos = categorical ? x(i, ticks.length) : L + (R - L) * ticks[i];
    el.append(
      svg(
        "text",
        { x: pos, y: h - 8, "text-anchor": "middle" },
        categorical ? String(ticks[i]) : `${ticks[i].toFixed(1)}y`,
      ),
    );
  }
  if (selected !== null) {
    const a = series[0].values;
    el.append(
      svg("circle", {
        cx: x(selected, a.length),
        cy: y(a[selected]),
        r: 4,
        "data-selected": selected,
      }),
    );
  }
}
function draw() {
  chart("spotChart", [{ values: prices }]);
  chart("errorChart", [{ values: result.rows.map((r) => r.error) }], {
    zero: true,
    selected: Number($("event").value),
  });
  chart(
    "compareChart",
    [
      { values: stats.map((r) => r.grossRmse) },
      { values: stats.map((r) => r.rmse) },
    ],
    { categorical: true, labels: stats.map((r) => r.intervals), zero: true },
  );
}
function inspect() {
  const i = Number($("event").value),
    r = result.rows[i];
  $("rownote").textContent =
    `event ${i}/${applied.intervals} · t ${r.time.toFixed(6)} years · ${i === 0 ? "opening" : i === applied.intervals ? "liquidation" : "rebalance"}`;
  const fields = [
    ["Step / of 252", r.step.toFixed(0)],
    ["Spot", fmt(r.spot)],
    ["Accrued cash", fmt(r.accrued)],
    ["Old stock holding", fmt(r.previousDelta)],
    ["New stock holding", fmt(r.delta)],
    ["Trade / shares", fmt(r.trade)],
    ["Fee", fmt(r.fee)],
    ["Cash after trade", fmt(r.cash)],
    ["Option mark", fmt(r.mark)],
    ["Hedge equity", fmt(r.equity)],
    ["Residual / net", fmt(r.error)],
  ];
  $("audit").replaceChildren(
    ...fields.map(([label, value]) => {
      const dl = node("dl");
      dl.append(node("dt", label), node("dd", value));
      return dl;
    }),
  );
  $("equation").textContent =
    `Cash ${fmt(r.cash)} = accrued ${fmt(r.accrued)} − trade ${fmt(r.trade)} × spot ${fmt(r.spot)} − fee ${fmt(r.fee)}. Equity ${fmt(r.equity)} = cash + ${fmt(r.delta)} × spot. Residual ${fmt(r.error)} = equity − option mark ${fmt(r.mark)}. Display rounded; calculation uses full precision.`;
  chart("errorChart", [{ values: result.rows.map((r) => r.error) }], {
    zero: true,
    selected: i,
  });
}
function render() {
  prices = path(applied);
  result = hedge(applied, prices);
  stats = compare(applied);
  $("event").max = applied.intervals;
  $("event").value = Math.min(Number($("event").value), applied.intervals);
  for (const [id, k] of [
    ["premium", "premium"],
    ["gross", "gross"],
    ["net", "net"],
    ["financed", "financedFees"],
  ])
    $(id).textContent = fmt(result[k]);
  $("nominal").textContent = `Nominal fee sum ${fmt(result.nominalFees)}`;
  $("pathnote").textContent =
    `stream 0 · ${applied.intervals} intervals · ${252 / applied.intervals} model steps per interval`;
  const body = $("ledger").tBodies[0];
  body.replaceChildren(
    ...result.rows.map((r) => {
      const tr = node("tr");
      for (const key of [
        "step",
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
      ])
        tr.append(node("td", key === "step" ? String(r[key]) : fmt(r[key])));
      return tr;
    }),
  );
  $("comparison").tBodies[0].replaceChildren(
    ...stats.map((r) => {
      const tr = node("tr");
      for (const key of [
        "intervals",
        "grossRmse",
        "rmse",
        "mean",
        "sd",
        "meanFees",
      ])
        tr.append(
          node("td", key === "intervals" ? String(r[key]) : fmt(r[key])),
        );
      return tr;
    }),
  );
  $("status").className = "eyebrow";
  $("status").textContent =
    `APPLIED / ${applied.kind} · path σ ${applied.pathSigma * 100}% · hedge σ ${applied.hedgeSigma * 100}% · ${applied.bps} bps · N ${applied.intervals} · seed ${applied.seed}`;
  inspect();
  draw();
}
$("controls").addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    const p = {};
    for (const k of keys) {
      if ($(k).value.trim() === "")
        throw Error("All inputs are required. Previous experiment retained.");
      p[k] = k === "kind" ? $(k).value : Number($(k).value);
    }
    p.pathSigma /= 100;
    p.hedgeSigma /= 100;
    validate(p);
    applied = p;
    render();
  } catch (err) {
    $("status").className = "eyebrow invalid";
    $("status").textContent = err.message + " Previous experiment retained.";
  }
});
$("controls").noValidate = true;
for (const k of keys)
  $(k).addEventListener("input", () => {
    $("status").textContent =
      "UNAPPLIED / showing the last completed experiment. Run experiment to apply changes.";
  });
$("event").addEventListener("input", inspect);
let timer;
window.addEventListener("resize", () => {
  clearTimeout(timer);
  timer = setTimeout(draw, 80);
});
render();
