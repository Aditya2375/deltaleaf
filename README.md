# deltaleaf

A Java-first discrete delta-hedging experiment, with a dependency-free browser mirror. Sell one European call or put at its Black-Scholes premium, hold its delta in the underlying, and finance every stock trade through cash. Inspect the hedge error and the cash ledger, including opening and closing costs.

## What it does

- Reproducible synthetic GBM path, 252 equal model steps over one year.
- Separate path volatility and hedge/pricing volatility, each 10-50%.
- Choice of 1, 4, 12, 28, 84 or 252 hedge intervals, all sampling the same underlying path.
- Proportional stock fees, 0-25 one-way basis points, on opening, interior trades and terminal liquidation.
- Full cash ledger and event inspector, gross and net terminal P&L, nominal and financed fees.
- Descriptive frequency comparison on 128 other seeded paths, shared across frequencies: gross/net RMSE, net mean, net population SD and mean nominal fees.

Fixed assumptions: initial spot and strike 100, one-year expiry, zero dividends, continuous interest rate 2%. The simulated GBM drift is also fixed at 2%, not an estimated physical drift. There is one short option per underlying unit, no contract multiplier or currency. Cash settlement at expiry follows the stock liquidation. The option premium uses hedge volatility and is not adjusted for costs.

## Run locally

Java 21+:

```sh
javac -d build/classes src/deltaleaf/*.java tools/*.java tests/deltaleaf/*.java
java -cp build/classes deltaleaf.TestRunner
java -cp build/classes Dump 0.2 0.2 5 28 2375 call
```

Browser demo, Python 3:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
```

Open the printed local address. No installation or runtime packages. `docs/` contains only static files built from `web/`.

Build/test tools, Node 22+ and Python 3:

```sh
node tools/build-web.mjs
node tests/parity.mjs
node tests/domain.mjs
python3 tests/reference.py
node tests/browser-smoke.mjs
```

Java must be available as `java`, or set `JAVA` for parity/reference checks. Browser smoke needs Google Chrome as `google-chrome`. Optional `SMOKE_URL` tests a deployed site, and `SMOKE_SHOTS=1` saves local screenshots. Build and test artifacts are excluded from source control.

## Accounting and interpretation

See [NUMERICS.md](NUMERICS.md) for exact ordering, equations, random generator, parameter bounds and comparison definitions. Self-financing means no external cash is injected after receipt of the premium. It does **not** mean the hedge replicates the option exactly at discrete dates. Fees reduce equity, with their funding charged through the same cash account.

A single path can lose money, and higher frequency can make a path or a finite sample worse. Gross-minus-net P&L equals the future value of fees, not their nominal sum. RMSE measures deviation from zero, while SD measures dispersion around the sample mean. Neither is a forecast or an optimal-frequency recommendation. The seeded sample is small and descriptive, with no statistical independence or confidence-interval claim.

No market data, accounts, uploads, browser storage, telemetry, runtime network calls, broker keys, real orders or paid service. Source links are ordinary links opened only if a visitor chooses to follow them. No external code, datasets, papers, fonts or assets are bundled. This is an educational simulation, not investment advice.

## Background

- [UT Austin: discrete self-financing](https://web.ma.utexas.edu/users/mcudina/m339w-delta-hedging-continued.pdf).
- [Macroption: Black-Scholes price and Greek formulas](https://www.macroption.com/black-scholes-formula/).
- [John Armstrong: discrete delta hedging and proportional costs](https://johnarmstrongmaths.com/courses/fm06/book/matlab-chapter6.pdf).
- [Simon Ellersgaard Nielsen: Hedging Outside of Utopia](https://sellersgaard.github.io/blog/2023/hedgeessays/).

Original code is available under **MIT OR Apache-2.0**. Choose either [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE).
