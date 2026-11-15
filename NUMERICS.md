# Model and numerical contract

## Domain

Short one European call or put, K = S0 = 100, T = 1 year, q = 0, continuously compounded r = 0.02. Path volatility and hedge volatility each lie in [0.1, 0.5]. One-way stock fee c = bps/10,000, bps in [0,25]. Seed is an integer in [1,999999]. Hedge interval count N is one of {1,4,12,28,84,252}, all divisors of 252. UI and Java/JS helpers use the same domain. Inputs must be finite. Path helpers accept exactly 253 strictly positive finite prices with initial price exactly 100. No outside input/import feature is exposed in the browser.

## Price, delta and paths

For remaining time tau > 0, v = hedgeSigma sqrt(tau), d1 = [ln(S/K) + (r + hedgeSigma²/2)tau]/v and d2 = d1 - v. Call price = S Phi(d1) - K exp(-r tau) Phi(d2), call delta = Phi(d1). Put price = K exp(-r tau) Phi(-d2) - S Phi(-d1), put delta = Phi(d1)-1. Phi is original 64-point Gauss-Legendre integration of normal density on [|x|,12], with symmetry, exact Phi(0)=0.5 and saturated tails beyond 12. It is not a general high-relative-accuracy extreme-tail library. No density fitting or calibration.

At tau = 0, price is intrinsic payoff. The returned delta = 0 is a liquidation sentinel, not a mathematical Black-Scholes delta at expiry. No terminal rehedge to an indicator is performed before liquidation.

Each exact GBM grid transition is S[k+1] = S[k] exp[(r - pathSigma²/2)/252 + pathSigma Z/sqrt(252)]. Exact refers to the model transition formula, not perfect randomness or a real-market model. Each Z uses two successive LCG uniforms and Box-Muller cosine, with no cached sine. State = (1664525 state + 1013904223) mod 2^32; uniform = (state+0.5)/2^32. Initial state = (seed + 104729 stream) mod 2^32. Stream 0 is the illustrated path, streams 1..128 are the descriptive comparison. The integer LCG is for reproducibility, not cryptography or a production statistical generator. No independence/inference claim. Browser multiplication uses Math.imul; Java uses long arithmetic plus a 32-bit mask.

## Exact event ordering

Hedge dates k/N, k = 0..N; selected base index = k × (252/N). There are N+1 events: opening, N-1 interior rebalances, terminal liquidation. Delta only uses the current price and time. The future path is never used to choose the current position.

1. Start cash B = initial Black-Scholes premium, old stock holding D = 0.
2. At opening, accrued cash = B. At later dates, accrued cash = B exp(r/N), on deposits and borrowing alike.
3. At nonterminal dates new holding Dnew is the Black-Scholes delta. At the final date Dnew = 0 to liquidate all stock.
4. Trade = Dnew - D. Fee = c S |trade|, for both buys and sells.
5. Bnew = accrued cash - S trade - fee. A stock sale adds cash through the signed trade; its fee still subtracts cash.
6. Hedge equity = Bnew + Dnew S. Residual = hedge equity - current option mark.
7. At expiry the mark is payoff. Because the holding has been liquidated, terminal net P&L = cash - payoff. The table's terminal cash is **before** the option payoff is subtracted.

The opening residual is minus the opening stock fee. No option trading fee, cost-adjusted premium, dividends, external cash injection, margin or physical delivery is modeled. Equity includes borrowed cash and can be negative. Fractional shares and unrestricted borrowing/shorting are idealizations.

A second cash account follows identical stock trades at zero fees. Its terminal cash minus payoff is gross P&L. Financed fees = sum fee[k] exp(r(1-k/N)). Gross - net = financed fees to floating-point accuracy. The nominal fee sum is also shown; it differs when funding is nonzero.

## Comparison

For each frequency reuse all 128 complete price paths. Frequency changes do not regenerate or interpolate paths. All have the same terminal prices and initial premiums at fixed parameters. The illustrated path is excluded from comparison.

Net mean = sum(net P&L)/128. Population SD = sqrt(sum((net P&L - mean)²)/128). Net RMSE = sqrt(sum(net P&L²)/128); gross RMSE uses gross P&L. Mean nominal fees = sum(nominal fees)/128. Thus RMSE² = SD² + mean², up to rounding. SD is not a standard error. There are no estimated probabilities, quantiles, confidence intervals or frequency optimization. More hedging can increase fees and does not guarantee better realized error or RMSE. Volatility mismatch can create systematic errors.

Charts connect observations for inspection only. Spot and residual use linear time axes; residual is shown only at hedge events. Frequency plot uses equally spaced categories, not a linear N axis. Values are rounded to six decimals in tables/headlines; the calculation uses full precision. Small display values round to zero. Plot scaling has padding and does not imply error bounds. The selected marker refers to the cash inspector event. Changes to controls do not apply until submission; invalid input retains the previous model and charts. Resizing uses applied inputs.

## Verification

Java tests cover all event equations, fees, liquidation, call/put parity, domain corners and a closed-form one-interval cash ledger. Java/JS tests compare every illustrated-path spot, every ledger field, summary, every comparison statistic and every comparison-path terminal error. JS domain tests include deterministic flat, growth and alternating paths. Python independently uses math.erfc Black-Scholes values and a discounted-gains/present-value sum rather than the mutable cash-account recurrence. This checks shared-port errors beyond parity. Chrome smoke checks all displayed values, all chart points and selected markers, controls/retention/clamping, widths 768/390/360/320, contained table scrolling, console exceptions, requests, CSP and storage. Tests do not prove the model is appropriate for real hedging. Native Safari/Android are not tested.

## Limits

GBM with fixed drift/volatility, European vanilla payoff, one fixed horizon/strike/rate, simplified symmetric funding and proportional cost. No jumps, stochastic volatility, market calibration, dividends, actual bid/ask book, market impact, liquidity, margin, integer lots, real orders or risk-free discrete replication claim. Small seeded samples are illustrative and can change materially with the seed. This is not investment advice.
