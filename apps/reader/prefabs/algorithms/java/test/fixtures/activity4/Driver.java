package es.uvigo.esei.aed2.activity4;

import java.util.Arrays;

// Runs cases of MaxHeapTestCase and HeapSortTestCase and prints the results.
public class Driver {
  private static BinaryMaxHeap<Integer> heapWith(int... values) {
    BinaryMaxHeap<Integer> heap = new BinaryMaxHeap<>();
    for (int v : values) heap.add(v);
    return heap;
  }

  private static String contents(BinaryMaxHeap<Integer> heap) {
    StringBuilder sb = new StringBuilder("[");
    while (!heap.isEmpty()) {
      sb.append(heap.removeMaxValue());
      if (!heap.isEmpty()) sb.append(", ");
    }
    return sb.append("]").toString();
  }

  public static void main(String[] args) {
    BinaryMaxHeap<Integer> heap = heapWith(50, 47, 22, 32, 44, 12, 19, 16, 3, 37);
    System.out.println("isEmpty=" + heap.isEmpty() + " max=" + heap.getMaxValue());
    System.out.println("removeMax=" + heap.removeMaxValue() + " then max=" + heap.getMaxValue());
    System.out.println("drain=" + contents(heapWith(50, 47, 22, 32, 44, 12, 19, 16, 3, 37)));
    try {
      new BinaryMaxHeap<Integer>().removeMaxValue();
    } catch (HeapEmptyException e) {
      System.out.println("empty remove: " + e.getClass().getSimpleName());
    }
    try {
      heap.add(null);
    } catch (NullPointerException e) {
      System.out.println("add null: NullPointerException");
    }
    BinaryMaxHeap<Integer> nine = heapWith(50, 47, 22, 32, 44, 12, 19, 16, 3, 37);
    for (int i = 1; i <= 9; i++) nine.removeMaxValue();
    System.out.println("after 9 removes max=" + nine.getMaxValue());
    int[] single = { 23 };
    try {
      HeapSort.heapSort(single);
      System.out.println("heapSort single=" + Arrays.toString(single));
    } catch (RuntimeException e) {
      System.out.println("heapSort single threw " + e.getClass().getSimpleName() + ": " + e.getMessage());
    }
    int[] values = { 23, 45, 12, 34, 67, 43, 76, 88, 69, 28, 61 };
    try {
      HeapSort.heapSort(values);
      System.out.println("heapSort=" + Arrays.toString(values));
    } catch (RuntimeException e) {
      System.out.println("heapSort threw " + e.getClass().getSimpleName() + ": " + e.getMessage());
    }
  }
}
