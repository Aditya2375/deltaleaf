import deltaleaf.Engine;

public class Dump {
  public static void main(String[] a) {
    var p =
        new Engine.Params(
            Double.parseDouble(a[0]),
            Double.parseDouble(a[1]),
            Double.parseDouble(a[2]),
            Integer.parseInt(a[3]),
            Integer.parseInt(a[4]),
            a[5]);
    var path = Engine.path(p, 0);
    for (int i = 0; i < path.length; i++) System.out.println("P," + i + "," + path[i]);
    var r = Engine.hedge(p, path);
    System.out.println(
        "R,"
            + r.premium()
            + ","
            + r.gross()
            + ","
            + r.net()
            + ","
            + r.nominalFees()
            + ","
            + r.financedFees());
    for (var v : r.rows())
      System.out.println(
          "L,"
              + v.step()
              + ","
              + v.time()
              + ","
              + v.spot()
              + ","
              + v.accrued()
              + ","
              + v.previousDelta()
              + ","
              + v.delta()
              + ","
              + v.trade()
              + ","
              + v.fee()
              + ","
              + v.cash()
              + ","
              + v.mark()
              + ","
              + v.equity()
              + ","
              + v.error());
    for (var v : Engine.compare(p)) {
      System.out.println(
          "S,"
              + v.intervals()
              + ","
              + v.mean()
              + ","
              + v.sd()
              + ","
              + v.rmse()
              + ","
              + v.grossRmse()
              + ","
              + v.meanFees());
      for (int i = 0; i < v.errors().length; i++)
        System.out.println("E," + v.intervals() + "," + i + "," + v.errors()[i]);
    }
  }
}
