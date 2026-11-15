package deltaleaf;

public class TestRunner {
  static int count = 0;

  static void check(boolean b, String m) {
    count++;
    if (!b) throw new AssertionError(m);
  }

  static void close(double a, double b, double tol, String m) {
    check(
        Math.abs(a - b) <= tol * Math.max(1, Math.max(Math.abs(a), Math.abs(b))),
        m + " " + a + " vs " + b);
  }

  public static void main(String[] ignored) {
    close(Engine.cdf(0), .5, 1e-14, "cdfzero");
    close(Engine.cdf(1), .8413447460685429, 1e-13, "cdf1");
    close(Engine.quote(100, 1, .2, "call").price(), 8.916037278572539, 1e-12, "knowncall");
    for (String kind : new String[] {"call", "put"})
      for (double ps : new double[] {.1, .2, .35, .5})
        for (double hs : new double[] {.1, .2, .5})
          for (double bps : new double[] {0, 5, 25})
            for (int seed : new int[] {1, 2375, 999999})
              for (int n : Engine.frequencies()) {
                var p = new Engine.Params(ps, hs, bps, n, seed, kind);
                double[] path = Engine.path(p, 0);
                var r = Engine.hedge(p, path);
                check(r.rows().length == n + 1, "rows");
                close(r.gross() - r.net(), r.financedFees(), 2e-11, "financedcostidentity");
                double cash = r.premium(), old = 0, feeSum = 0;
                for (int k = 0; k <= n; k++) {
                  var row = r.rows()[k];
                  double accrued = k == 0 ? cash : cash * Math.exp(Engine.RATE / n);
                  close(row.accrued(), accrued, 1e-12, "interest");
                  close(row.trade(), row.delta() - old, 1e-13, "trade");
                  close(row.fee(), Math.abs(row.trade()) * row.spot() * bps / 10000, 1e-13, "fee");
                  close(row.cash(), accrued - row.trade() * row.spot() - row.fee(), 1e-12, "cash");
                  close(row.equity(), row.cash() + row.delta() * row.spot(), 1e-12, "equity");
                  close(row.error(), row.equity() - row.mark(), 1e-12, "error");
                  check(
                      kind.equals("call")
                          ? row.delta() >= 0 && row.delta() <= 1
                          : row.delta() >= -1 && row.delta() <= 0,
                      "deltabounds");
                  feeSum += row.fee();
                  cash = row.cash();
                  old = row.delta();
                }
                close(feeSum, r.nominalFees(), 1e-12, "nominalfees");
                close(old, 0, 0, "liquidated");
                close(r.rows()[n].error(), r.net(), 1e-12, "terminal");
                check(r.net() <= r.gross() + 1e-10, "costreducespnl");
                if (bps == 0) close(r.gross(), r.net(), 0, "zerocost");
                var call = Engine.quote(path[126], .5, hs, "call");
                var put = Engine.quote(path[126], .5, hs, "put");
                close(
                    call.price() - put.price(),
                    path[126] - 100 * Math.exp(-Engine.RATE * .5),
                    2e-12,
                    "putcallparity");
                close(call.delta() - put.delta(), 1, 1e-13, "deltaparity");
              }
    // One interval has only opening stock and terminal liquidation: a closed-form cash ledger.
    for (String kind : new String[] {"call", "put"}) {
      var p = new Engine.Params(.2, .2, 10, 1, 2375, kind);
      var s = Engine.path(p, 0);
      var r = Engine.hedge(p, s);
      double d = Engine.quote(100, 1, .2, kind).delta(),
          c0 = r.premium() - 100 * d - Math.abs(d) * .1;
      double value =
          c0 * Math.exp(.02)
              + d * s[252]
              - Math.abs(d) * s[252] * .001
              - Engine.quote(s[252], 0, .2, kind).price();
      close(r.net(), value, 1e-12, "analytic1interval");
    }
    var p = new Engine.Params(.2, .2, 5, 28, 2375, "call");
    for (var s : Engine.compare(p)) {
      double mean = 0, sq = 0;
      for (double e : s.errors()) {
        mean += e;
        sq += e * e;
      }
      mean /= 128;
      close(mean, s.mean(), 1e-13, "mean");
      close(Math.sqrt(sq / 128), s.rmse(), 1e-13, "rmse");
      close(s.rmse() * s.rmse(), s.sd() * s.sd() + s.mean() * s.mean(), 1e-11, "momentidentity");
    }
    try {
      Engine.hedge(p, new double[253]);
      throw new AssertionError("badpathaccepted");
    } catch (IllegalArgumentException good) {
      count++;
    }
    System.out.println(count + " Java assertions passed");
  }
}
