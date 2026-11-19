package es.uvigo.esei.aed2.activity10;

/*-
 * #%L
 * AEDII - Activities
 * %%
 * Copyright (C) 2025 Rosalía Laza Fidalgo, María Reyes Pavón Rial,
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

public class DivideAndConquerAlgorithm {
  // Exercise 1
  public static int quickSelection(int[] array, int k_minor, int i, int j) {
    // solution written for the simulator's tests (the activities repo leaves it as a stub)
    int pivotPosition = searchPivotPosition(i, j, array);
    if (pivotPosition == -1) return array[i]; // one element, or all equal
    int pivot = array[pivotPosition];
    exchange(pivotPosition, j, array);
    int k = partition(i, j, pivot, array); // [i, k) < pivot <= [k, j]
    if (k_minor - 1 < k) return quickSelection(array, k_minor, i, k - 1);
    return quickSelection(array, k_minor, k, j);
  }

  /*
   * Entre dos elementos diferentes el pivote será el mayor devuelve la posición del elemento pivote.
   */
  private static int searchPivotPosition(int i, int j, int[] array) {
    int first = array[i];
    int k = i + 1;

    while (k <= j) {
      if (array[k] > first) {
        return k;
      } else if (array[k] < first) {
        return i;
      } else {
        k++;
      }
    }
    // Si llega al endal del array y todos los elementos son iguales
    return -1;
  }

  /*
   * Distribuye el array en menores que pivote, y mayores e igual a pivote.
   * Devuelve la posición del primer elemento de los mayores.
   */
  private static int partition(int i, int j, int pivot, int[] array) {
    int right = i;
    int left = j - 1; // privote está en la última posición
    do {

      while (array[right] < pivot) {
        right++;
      }

      while (array[left] >= pivot) {
        left--;
      }

      if (right < left) {
        exchange(right, left, array);
      }
    } while (right <= left);

    return right;
  }

  // Intercambia dos elementos en el array
  private static void exchange(int i, int j, int[] array) {
    int aux = array[i];
    array[i] = array[j];
    array[j] = aux;
  }

  // Exercise 2
  public static String moveHanoiDiscs(int numDiscs, String startPost, String auxiliaryPost, String endPost) {
    StringBuilder movements = new StringBuilder();
    moveHanoiDiscsRecursive(numDiscs, startPost, auxiliaryPost, endPost, movements);
    return movements.toString();
  }

  private static void moveHanoiDiscsRecursive(
    int numDiscs, String startPost, String auxiliaryPost, String endPost, StringBuilder movements
  ) {
    // solution written for the simulator's tests (the activities repo leaves it as a stub)
    if (numDiscs == 1) {
      keepMoving(1, startPost, endPost, movements);
    } else {
      moveHanoiDiscsRecursive(numDiscs - 1, startPost, endPost, auxiliaryPost, movements);
      keepMoving(numDiscs, startPost, endPost, movements);
      moveHanoiDiscsRecursive(numDiscs - 1, auxiliaryPost, startPost, endPost, movements);
    }
  }

  private static void keepMoving(int n, String postI, String postF, StringBuilder movements) {
    movements.append("Disc ").append(n).append(" from ").append(postI).append(" to ").append(postF).append("\n");
  }

  // Exercise 3
  public static int numberExists(int[] array, int start, int end) {
    return -1;
  }

  // Exercise 4
  public static int searchPositionK(int[] v, int start, int end) {
    return -1;
  }

  // Exercise 5
  public static int inversions(int[] array, int start, int end) {
    return 0;
  }

  // Mezcla ordenanado los elmentos de las dos mitades y devuelve el número de inversiones entre ellas
  private static int mergeCount(int[] aux, int start1, int end1, int start2, int end2) {
    int i = start1;
    int j = start2;
    int cont = 0;
    int pos = start2 - start1; // número máximo de diferencias
    ArrayList<Integer> temp = new ArrayList<>();
    while (i <= end1 && j <= end2) {
      if (aux[i] <= aux[j]) {
        temp.add(aux[i++]);
        pos--;
      } else {
        temp.add(aux[j++]);
        cont += pos;
      }
    }
    while (i <= end1) {
      temp.add(aux[i++]);
    }
    while (j <= end2) {
      temp.add(aux[j++]);
    }
    for (i = start1; i <= end2; i++) { // Paso todos los elementos del Temporal al array
      aux[i] = temp.remove(0);
    }
    return cont;
  }

}
