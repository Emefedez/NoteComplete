package es.uvigo.esei.aed2.activity11;
/*-
 * #%L
 * AEDII - Activities
 * %%
 * Copyright (C) 2026 Rosalía Laza Fidalgo, María Reyes Pavón Rial,
 * Florentino Fernández Riverola, María Novo Lourés, and Miguel Reboiro Jato
 * %%
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * #L%
 */

import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;

import es.uvigo.esei.aed2.map.*;


public class DynamicProgrammingAlgorithm {
  // Exercise 1
  public static int fibonacciDynamic(int n) {
    // solutions written for the simulator's tests (the activities repo leaves them as stubs)
    if (n <= 1) return n;
    int[] table = new int[n + 1];
    table[0] = 0;
    table[1] = 1;
    for (int i = 2; i <= n; i++) {
      table[i] = table[i - 1] + table[i - 2];
    }
    return table[n];
  }

  // Exercise 2
  public static List<String> fillRucksackDynamic(int maxWeight, Map<String, Integer> volumes, Map<String, Integer> weights) {
    List<String> objects = new ArrayList<>(volumes.getKeys());
    int n = objects.size();
    int[][] table = new int[n + 1][maxWeight + 1]; // best volume with the first i objects and weight w
    for (int i = 1; i <= n; i++) {
      String object = objects.get(i - 1);
      int weight = weights.get(object);
      int volume = volumes.get(object);
      for (int w = 0; w <= maxWeight; w++) {
        table[i][w] = table[i - 1][w];
        if (weight <= w && table[i - 1][w - weight] + volume > table[i][w]) {
          table[i][w] = table[i - 1][w - weight] + volume;
        }
      }
    }
    List<String> chosen = new LinkedList<>();
    for (int i = n, w = maxWeight; i > 0; i--) {
      if (table[i][w] != table[i - 1][w]) {
        chosen.add(objects.get(i - 1));
        w -= weights.get(objects.get(i - 1));
      }
    }
    return chosen;
  }
  
  // Exercise 3
  public static Map<Integer, Integer> giveChangeDynamic(int amountReturned, Map<Integer, Integer> changeAvailable) {


    return null;
  }
}

