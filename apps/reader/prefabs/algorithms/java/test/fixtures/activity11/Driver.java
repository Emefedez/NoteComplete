package es.uvigo.esei.aed2.activity11;

import es.uvigo.esei.aed2.map.HashMap;
import es.uvigo.esei.aed2.map.Map;

// Runs testFibonacciDynamic and testFillRucksackDynamic.
public class Driver {
  public static void main(String[] args) {
    System.out.println("fibonacciDynamic(10)=" + DynamicProgrammingAlgorithm.fibonacciDynamic(10));
    String[] objects = { "car", "doll", "ball", "bike" };
    int[] volumes = { 4, 5, 10, 3 }, weights = { 3, 4, 5, 2 };
    Map<String, Integer> v = new HashMap<>(), w = new HashMap<>();
    for (int i = 0; i < objects.length; i++) { v.add(objects[i], volumes[i]); w.add(objects[i], weights[i]); }
    System.out.println("fillRucksackDynamic(9)=" + DynamicProgrammingAlgorithm.fillRucksackDynamic(9, v, w));
  }
}
