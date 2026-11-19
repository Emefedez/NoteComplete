import java.util.*;
import java.util.function.*;
import static java.lang.Math.*;

// Java semantics the simulator must reproduce; expected.txt is the JVM's output.
public class Semantics {
  interface Shape { double area(); default String describe() { return getClass().getSimpleName() + " " + area(); } }
  record Rect(int w, int h) implements Shape { public double area() { return w * h; } }
  enum Day { MON, TUE, WED; Day next() { return values()[(ordinal() + 1) % values().length]; } }

  static class Box<T extends Comparable<T>> {
    private T value;
    Box(T value) { this.value = value; }
    T get() { return value; }
    boolean bigger(Box<T> o) { return value.compareTo(o.value) > 0; }
  }

  static class MyException extends RuntimeException {
    MyException(String m) { super(m); }
  }

  private int counter = 10;
  class Inner { int twice() { return counter * 2; } }

  static int depth = 0;
  static int recurse(int n) { depth = n; return recurse(n + 1) + 1; }

  static String order = "";
  static int tryFinally() {
    try { order += "t"; throw new MyException("boom"); }
    catch (MyException e) { order += "c"; return 1; }
    finally { order += "f"; }
  }

  public static void main(String[] args) {
    // integers
    int big = Integer.MAX_VALUE;
    System.out.println(big + 1);
    System.out.println(big * 2);
    long lbig = Long.MAX_VALUE;
    System.out.println(lbig + 1);
    System.out.println(7 / 2 + " " + (-7 / 2) + " " + 7 % -3 + " " + (-7 % 3));
    System.out.println(1 / 2 * 4.0 + " " + 1.0 / 2 * 4 + " " + (double) 1 / 2);
    System.out.println(10 / 3 * 3 + " " + 10 % 3 + " " + 10.0 % 3);
    int x = 5; x += 3.7; System.out.println(x);
    short s = 10; s *= 1000; s *= 10; System.out.println(s);
    byte b = (byte) 200; System.out.println(b);
    System.out.println((int) 3.99 + " " + (int) -3.99 + " " + (long) 1e19 + " " + (int) Double.NaN);
    System.out.println(0x7f + 010 + 0b11 + 1_000);
    System.out.println(1 << 33 + " ".length());
    System.out.println(abs(-4) + " " + max(3, 7L) + " " + pow(2, 10) + " " + sqrt(2));
    try { System.out.println(1 / (x - 8)); } catch (ArithmeticException e) { System.out.println("caught " + e.getMessage()); }
    System.out.println(5.0 / 0 + " " + (0.0 / 0.0) + " " + -5.0 / 0);
    System.out.println(0.1 + 0.2);
    System.out.println(100.0 / 3 + " " + 1e-5 + " " + 123456789.0 + " " + 2.5f + " " + (float) 1 / 3);

    // chars
    char c = 'a';
    System.out.println(c + 1);
    System.out.println((char) (c + 1));
    c++; c += 2;
    System.out.println(c);
    System.out.println("" + c + 'z' + " " + (c + 'z') + " " + (char) 66);
    System.out.println(Character.isDigit('7') + " " + Character.toUpperCase('q') + " " + ('9' - '0') + " " + Character.getNumericValue('8'));
    int[] counts = new int[26];
    for (char ch : "banana".toCharArray()) counts[ch - 'a']++;
    System.out.println(Arrays.toString(Arrays.copyOf(counts, 3)));

    // strings
    String a1 = "hello", a2 = "hello", a3 = new String("hello"), a4 = "hel" + "lo";
    String part = "hel"; String a5 = part + "lo";
    System.out.println((a1 == a2) + " " + (a1 == a3) + " " + a1.equals(a3) + " " + (a1 == a4) + " " + (a1 == a5) + " " + (a1 == a5.intern()));
    System.out.println("abc".compareTo("abd") + " " + "b".compareTo("a") + " " + "apple".compareTo("app"));
    System.out.println("Hola Mundo".substring(5).toUpperCase() + "|" + "  x ".trim() + "|" + "a-b-c".replace('-', '+') + "|" + String.join(",", List.of("x", "y")));
    System.out.println("mississippi".indexOf("ss") + " " + "mississippi".lastIndexOf('s') + " " + "abc".charAt(1) + " " + "abc".contains("bc"));
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 3; i++) sb.append(i).append(',');
    sb.setLength(sb.length() - 1);
    System.out.println(sb.reverse() + " " + sb.length());
    System.out.println(String.valueOf(3.0) + String.valueOf(true) + String.valueOf('c') + null);
    System.out.println("x=" + 1 + 2 + " " + (1 + 2) + "=y" + " " + 1 + 'a' + " " + ('a' + 1 + "b"));
    System.out.println(String.format("%d|%5d|%-5s|%.3f|%c|%b|%x|%05d", 42, 7, "ab", Math.PI, 'Z', true, 255, 42));
    System.out.println("Abc".hashCode() + " " + Objects.hash(1, "a") + " " + Integer.valueOf(7).hashCode() + " " + Boolean.hashCode(true));

    // control flow
    outer:
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 4; j++) {
        if (j == 2) continue outer;
        if (i == 3) break outer;
        System.out.print(i + "" + j + " ");
      }
    }
    System.out.println();
    int k = 0;
    do { k += 3; } while (k < 10);
    System.out.println(k);
    for (int i = 0, j = 10; i < j; i += 3, j -= 3) System.out.print(i + ":" + j + " ");
    System.out.println();
    int day = 3;
    switch (day) { case 1: System.out.print("one "); case 3: System.out.print("three "); case 4: System.out.print("four "); break; default: System.out.print("other "); }
    System.out.println();
    String kind = switch (day) { case 1, 7 -> "weekend"; case 2, 3, 4, 5, 6 -> { String t = "week"; yield t + "day"; } default -> "?"; };
    System.out.println(kind);
    switch ("b") { case "a" -> System.out.println("A"); case "b" -> System.out.println("B"); default -> System.out.println("D"); }
    char grade = 'B';
    switch (grade) { case 'A': case 'B': System.out.println("good"); break; default: System.out.println("bad"); }
    System.out.println(tryFinally() + " " + order);
    try { recurse(0); } catch (StackOverflowError e) { System.out.println("stack overflow caught: " + (depth > 100)); }
    try { throw new MyException("custom"); } catch (IllegalStateException | MyException e) { System.out.println(e); }
    try { Object o = "str"; Integer i = (Integer) o; } catch (ClassCastException e) { System.out.println("ClassCastException"); }
    try { List<Integer> l = List.of(1); l.add(2); } catch (UnsupportedOperationException e) { System.out.println("immutable " + e.getMessage()); }
    try { List<Integer> l = new ArrayList<>(List.of(1, 2, 3)); for (Integer v : l) if (v == 2) l.remove(v); } catch (ConcurrentModificationException e) { System.out.println("CME"); }
    try { Integer.parseInt("12a"); } catch (NumberFormatException e) { System.out.println(e.getMessage()); }
    try { new ArrayList<Integer>().get(0); } catch (IndexOutOfBoundsException e) { System.out.println(e.getMessage()); }
    try { "abc".charAt(5); } catch (StringIndexOutOfBoundsException e) { System.out.println(e.getClass().getName()); }

    // classes
    Box<Integer> b1 = new Box<>(3), b2 = new Box<>(5);
    System.out.println(b1.bigger(b2) + " " + b2.bigger(b1) + " " + b2.get());
    Semantics outerObj = new Semantics();
    Semantics.Inner inner = outerObj.new Inner();
    System.out.println(inner.twice());
    Shape r = new Rect(2, 3);
    System.out.println(r.describe() + " " + r + " " + r.equals(new Rect(2, 3)));
    Day d = Day.TUE;
    System.out.println(d + " " + d.next() + " " + d.next().next() + " " + Day.valueOf("MON").ordinal() + " " + Arrays.toString(Day.values()));
    switch (d) { case MON -> System.out.println("lunes"); case TUE -> System.out.println("martes"); default -> System.out.println("otro"); }

    // collections and lambdas
    List<String> words = new ArrayList<>(List.of("pear", "fig", "banana", "kiwi"));
    words.sort((p, q) -> p.length() - q.length());
    System.out.println(words);
    words.sort(Comparator.comparing(String::length).reversed());
    System.out.println(words);
    Collections.sort(words);
    System.out.println(words + " " + Collections.max(words) + " " + words.indexOf("kiwi"));
    Map<String, Integer> lengths = new TreeMap<>();
    words.forEach(w -> lengths.put(w, w.length()));
    lengths.forEach((key, value) -> System.out.print(key + "=" + value + ";"));
    System.out.println();
    Map<Character, Integer> freq = new HashMap<>();
    for (char ch : "abracadabra".toCharArray()) freq.put(ch, freq.getOrDefault(ch, 0) + 1);
    System.out.println(freq);
    Deque<Integer> stack = new ArrayDeque<>();
    stack.push(1); stack.push(2); stack.push(3);
    System.out.println(stack.pop() + " " + stack.peek() + " " + stack);
    Queue<String> queue = new LinkedList<>();
    queue.offer("a"); queue.offer("b"); queue.add("c");
    System.out.println(queue.poll() + " " + queue.peek() + " " + queue.size());
    PriorityQueue<int[]> pq = new PriorityQueue<>((p, q) -> Integer.compare(p[1], q[1]));
    pq.add(new int[] { 1, 9 }); pq.add(new int[] { 2, 4 }); pq.add(new int[] { 3, 6 });
    System.out.print(pq.poll()[0]); System.out.print(pq.poll()[0]); System.out.println(pq.poll()[0]);
    Iterator<Integer> it = new ArrayList<>(List.of(1, 2, 3, 4)).iterator();
    int sum = 0;
    while (it.hasNext()) { int v = it.next(); if (v % 2 == 0) sum += v; }
    System.out.println(sum);
    BiFunction<Integer, Integer, Integer> add = (p, q) -> p + q;
    Function<Integer, Integer> sq = v -> v * v;
    Supplier<String> sup = () -> "supplied";
    Predicate<String> empty = String::isEmpty;
    System.out.println(add.apply(2, 3) + " " + sq.apply(9) + " " + sup.get() + " " + empty.test("") + " " + empty.negate().test(""));
    Runnable run = new Runnable() { public void run() { System.out.println("anonymous run " + words.size()); } };
    run.run();
    int[][] grid = new int[3][4];
    grid[1][2] = 5;
    int[][] jag = { { 1 }, { 2, 3 }, {} };
    System.out.println(Arrays.deepToString(grid) + " " + jag[1].length + " " + jag.length + " " + Arrays.deepToString(jag));
    Integer[] boxed = { 5, 1, 4 };
    Arrays.sort(boxed, Collections.reverseOrder());
    System.out.println(Arrays.toString(boxed));
    Integer i1 = 127, i2 = 127;
    System.out.println(i1.equals(i2) + " " + (i1 == i2) + " " + i1.compareTo(3));
    Map<String, List<Integer>> multi = new HashMap<>();
    multi.computeIfAbsent("odd", key -> new ArrayList<>()).add(1);
    multi.computeIfAbsent("odd", key -> new ArrayList<>()).add(3);
    System.out.println(multi);
    Set<Integer> set = new TreeSet<>(List.of(5, 1, 3));
    System.out.println(set + " " + ((TreeSet<Integer>) set).first());
  }
}
