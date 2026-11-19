package es.uvigo.esei.aed2.activity6.HashMap;

import java.util.Iterator;
import es.uvigo.esei.aed2.map.Map;

// Runs cases of MapTestCase (with the activity's own HashMap) and prints the results.
public class Driver {
  public static void main(String[] args) {
    Map<Integer, String> map = new HashMap<>();
    String[] names = { "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS" };
    for (int i = 0; i < names.length; i++) map.add(i + 1, names[i]);
    System.out.println("size=" + map.size() + " get(3)=" + map.get(3) + " get(100)=" + map.get(100) + " get(null)=" + map.get(null));
    map.add(3, "");
    System.out.println("after re-add size=" + map.size() + " get(3)='" + map.get(3) + "'");
    try {
      map.add(null, "x");
    } catch (NullPointerException e) {
      System.out.println("add(null): NullPointerException");
    }
    System.out.println("remove(3)='" + map.remove(3) + "' remove(100)=" + map.remove(100) + " size=" + map.size());
    System.out.println("keys=" + map.getKeys());
    StringBuilder values = new StringBuilder();
    Iterator<String> it = map.getValues();
    while (it.hasNext()) values.append(it.next()).append(' ');
    System.out.println("values=" + values.toString().trim());
    StringBuilder pairs = new StringBuilder();
    map.forEach((k, v) -> pairs.append(k).append('=').append(v).append(' '));
    System.out.println("forEach=" + pairs.toString().trim());
    Map<String, Integer> collide = new HashMap<>();
    collide.add("Aa", 1);
    collide.add("BB", 2); // same hashCode as "Aa"
    System.out.println("collisions=" + collide.get("Aa") + "," + collide.get("BB") + " size=" + collide.size());
    map.clear();
    System.out.println("clear size=" + map.size());
  }
}
