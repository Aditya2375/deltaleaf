package deltaleaf;

/** A finite, synthetic, cash-financed hedge experiment. No external dependencies. */
public final class Engine {
  private Engine() {}

  public static final int BASE = 252;
  public static final int SAMPLES = 128;
  public static final double RATE = 0.02;
  private static final int[] FREQUENCIES = {1, 4, 12, 28, 84, 252};

  public static int[] frequencies() {
    return FREQUENCIES.clone();
  }

  public record Params(
      double pathSigma, double hedgeSigma, double bps, int intervals, int seed, String kind) {}

  public record Quote(double price, double delta) {}

  public record Row(
      int step,
      double time,
      double spot,
      double accrued,
      double previousDelta,
      double delta,
      double trade,
      double fee,
      double cash,
      double mark,
      double equity,
      double error) {}

  public record Result(
      double premium,
      double gross,
      double net,
      double nominalFees,
      double financedFees,
      Row[] rows) {}

  public record Stats(
      int intervals,
      double mean,
      double sd,
      double rmse,
      double grossRmse,
      double meanFees,
      double[] errors) {}

  private static final double[] X = new double[64], W = new double[64];

  static {
    for (int i = 0; i < 32; i++) {
      double z = Math.cos(Math.PI * (i + 0.75) / 64.5), prev, pp = 0;
      for (int iteration = 0; iteration < 30; iteration++) {
        double p1 = 1, p2 = 0;
        for (int j = 1; j <= 64; j++) {
          double p3 = p2;
          p2 = p1;
          p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
        }
        pp = 64 * (z * p1 - p2) / (z * z - 1);
        prev = z;
        z = prev - p1 / pp;
        if (Math.abs(z - prev) < 2e-15) break;
      }
      X[i] = -z;
      X[63 - i] = z;
      W[i] = W[63 - i] = 2 / ((1 - z * z) * pp * pp);
    }
  }

  public static double cdf(double x) {
    if (!Double.isFinite(x)) throw new IllegalArgumentException("Finite normal argument required");
    if (x == 0) return .5;
    double a = Math.abs(x);
    if (a >= 12) return x < 0 ? 0 : 1;
    double mid = (a + 12) / 2, half = (12 - a) / 2, sum = 0;
    for (int i = 0; i < 64; i++) {
      double t = mid + half * X[i];
      sum += W[i] * Math.exp(-t * t / 2) / Math.sqrt(2 * Math.PI);
    }
    double tail = half * sum;
    return x < 0 ? tail : 1 - tail;
  }

  public static void validate(Params p) {
    if (p == null
        || !Double.isFinite(p.pathSigma)
        || p.pathSigma < .1
        || p.pathSigma > .5
        || !Double.isFinite(p.hedgeSigma)
        || p.hedgeSigma < .1
        || p.hedgeSigma > .5
        || !Double.isFinite(p.bps)
        || p.bps < 0
        || p.bps > 25
        || p.seed < 1
        || p.seed > 999999
        || !("call".equals(p.kind) || "put".equals(p.kind)))
      throw new IllegalArgumentException(
          "Volatilities10..50%, costs0..25bps, integerseed1..999999, call/put");
    boolean found = false;
    for (int n : FREQUENCIES) if (p.intervals == n) found = true;
    if (!found) throw new IllegalArgumentException("Allowed intervals1,4,12,28,84,252");
  }

  /** At expiry delta=0 is a liquidation sentinel, not a mathematical expiry delta. */
  public static Quote quote(double s, double tau, double sigma, String kind) {
    if (!Double.isFinite(s)
        || s <= 0
        || !Double.isFinite(tau)
        || tau < 0
        || tau > 1
        || !Double.isFinite(sigma)
        || sigma < .1
        || sigma > .5
        || !("call".equals(kind) || "put".equals(kind)))
      throw new IllegalArgumentException("Invalid quote domain");
    if (tau == 0) return new Quote(Math.max("call".equals(kind) ? s - 100 : 100 - s, 0), 0);
    double v = sigma * Math.sqrt(tau),
        d1 = (Math.log(s / 100) + (RATE + .5 * sigma * sigma) * tau) / v,
        d2 = d1 - v,
        b = 100 * Math.exp(-RATE * tau),
        delta = cdf(d1);
    return "call".equals(kind)
        ? new Quote(s * cdf(d1) - b * cdf(d2), delta)
        : new Quote(b * cdf(-d2) - s * cdf(-d1), delta - 1);
  }

  public static double[] path(Params p, int stream) {
    validate(p);
    if (stream < 0 || stream > SAMPLES) throw new IllegalArgumentException("stream0..128");
    long state = ((long) p.seed + 104729L * stream) & 0xffffffffL;
    double[] s = new double[BASE + 1];
    s[0] = 100;
    for (int i = 1; i <= BASE; i++) {
      state = (1664525L * state + 1013904223L) & 0xffffffffL;
      double u = (state + .5) / 4294967296.0;
      state = (1664525L * state + 1013904223L) & 0xffffffffL;
      double v = (state + .5) / 4294967296.0;
      double z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      s[i] =
          s[i - 1]
              * Math.exp(
                  (RATE - .5 * p.pathSigma * p.pathSigma) / BASE
                      + p.pathSigma / Math.sqrt(BASE) * z);
    }
    return s;
  }

  public static Result hedge(Params p, double[] s) {
    validate(p);
    if (s == null || s.length != BASE + 1 || s[0] != 100)
      throw new IllegalArgumentException("Path253, initial100");
    for (double v : s)
      if (!Double.isFinite(v) || v <= 0) throw new IllegalArgumentException("positive finite path");
    int stride = BASE / p.intervals;
    Row[] rows = new Row[p.intervals + 1];
    double premium = quote(100, 1, p.hedgeSigma, p.kind).price,
        cash = premium,
        grossCash = premium,
        old = 0,
        fees = 0,
        fv = 0;
    for (int k = 0; k <= p.intervals; k++) {
      int step = k * stride;
      double t = (double) step / BASE,
          growth = k == 0 ? 1 : Math.exp(RATE * stride / BASE),
          accrued = cash * growth;
      grossCash *= growth;
      Quote q = quote(s[step], 1 - t, p.hedgeSigma, p.kind);
      double delta = k == p.intervals ? 0 : q.delta,
          trade = delta - old,
          fee = Math.abs(trade) * s[step] * p.bps / 10000;
      cash = accrued - trade * s[step] - fee;
      grossCash -= trade * s[step];
      fees += fee;
      fv += fee * Math.exp(RATE * (1 - t));
      double equity = cash + delta * s[step];
      rows[k] =
          new Row(
              step,
              t,
              s[step],
              accrued,
              old,
              delta,
              trade,
              fee,
              cash,
              q.price,
              equity,
              equity - q.price);
      old = delta;
    }
    double payoff = quote(s[BASE], 0, p.hedgeSigma, p.kind).price;
    return new Result(premium, grossCash - payoff, cash - payoff, fees, fv, rows);
  }

  public static Stats[] compare(Params p) {
    validate(p);
    double[][] paths = new double[SAMPLES][];
    for (int j = 0; j < SAMPLES; j++) paths[j] = path(p, j + 1);
    Stats[] out = new Stats[FREQUENCIES.length];
    for (int i = 0; i < FREQUENCIES.length; i++) {
      Params a = new Params(p.pathSigma, p.hedgeSigma, p.bps, FREQUENCIES[i], p.seed, p.kind);
      double sum = 0, sq = 0, gsq = 0, fees = 0;
      double[] errors = new double[SAMPLES];
      for (int j = 0; j < SAMPLES; j++) {
        Result r = hedge(a, paths[j]);
        errors[j] = r.net;
        sum += r.net;
        sq += r.net * r.net;
        gsq += r.gross * r.gross;
        fees += r.nominalFees;
      }
      double mean = sum / SAMPLES, variance = 0;
      for (double e : errors) variance += (e - mean) * (e - mean);
      out[i] =
          new Stats(
              a.intervals,
              mean,
              Math.sqrt(variance / SAMPLES),
              Math.sqrt(sq / SAMPLES),
              Math.sqrt(gsq / SAMPLES),
              fees / SAMPLES,
              errors);
    }
    return out;
  }
}
