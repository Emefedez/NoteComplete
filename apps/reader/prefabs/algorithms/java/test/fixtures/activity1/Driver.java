package es.uvigo.esei.aed2.activity1;

import java.util.Arrays;
import java.util.Stack;

// Runs the cases of Activity1TestCase and prints the results.
public class Driver {
  public static void main(String[] args) {
    System.out.println("factorial(0)=" + Activity1.factorial(0));
    System.out.println("factorial(4)=" + Activity1.factorial(4));
    System.out.println("square(0)=" + Activity1.square(0));
    System.out.println("square(5)=" + Activity1.square(5));
    System.out.println("sumDigits(1111)=" + Activity1.sumDigits(1111));
    System.out.println("sumDigitsString(1369)=" + Activity1.sumDigitsString(1369));
    System.out.println("mcd(22,12)=" + Activity1.mcd(22, 12));
    System.out.println("invert=" + Activity1.invert("example"));
    System.out.println("addValues=" + Activity1.addValues(new int[] { 2, 4, 6, 8 }));
    System.out.println("addValuesWithFor=" + Activity1.addValuesWithFor(new int[] { 2, 4, 6, 8 }));
    int[] values = { 2, 4, 6, 8 };
    Activity1.invertArray(values);
    System.out.println("invertArray=" + Arrays.toString(values));
    System.out.println("minimum=" + Activity1.minimum(new int[] { 4, 3, 6, 2, 8 }));
    System.out.println("binarySearch=" + Activity1.binarySearch(new double[] { 1.1, 2.2, 3.3, 4.4, 5.5 }, 3.3));
    Stack<String> stack = new Stack<>();
    stack.addAll(Arrays.asList(new String[] { "AEDII", "Actividad", "Uno" }));
    Stack<String> copy = Activity1.copyStack(stack);
    System.out.println("copyStack=" + copy + " equal=" + stack.equals(copy) + " same=" + (stack == copy));
  }
}
