package es.uvigo.esei.aed2.activity1;

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

import java.util.Stack;

// Lo hice en python XDDD

public class Activity1 {

  /**
   * exercise 1
   *
   * @param number numero usado para calcular factorial.
   * @return el factorial de number.
   */
  public static long factorial(int number) {

    if (number <= 1) return 1;
    return number * factorial(number-1);
  }

  /**
   * exercise 2
   *
   * @param number numero usado para calcular el cuadrado.
   * @return el cuadrado de number.
   */
  public static int square(int number) {
    // para positivos

    if (number < 1) return 0; 
    return (square(number-1) + 2*number - 1);

  }

  /**
   * exercise 3
   *
   * @param number numero usado para sumar sus digitos.
   * @return la suma de los dígitos de number.
   */
  public static int sumDigitsString(int number) {
    String numString = String.valueOf(number);

    if (numString.length() <= 1) return number;

    int firstVal = Character.getNumericValue(numString.charAt(0));

    return  firstVal + sumDigitsString(Integer.parseInt(numString.substring(1)));

  }

  // versión que divide
  // 1369 / 10 = C:136, R:9
  // 1369 % 10 = 0

  public static int sumDigits(int number) {

    if (number < 10) return number; //si mi número es menor a 10

    int smallestPart = number % 10;

    return smallestPart + sumDigits(number/10);

  }

  /**
   * exercise 4
   *
   * @param number1 primer numero usado para calcular el MCD
   * @param number2 segundo numero usado para calcular el MCD
   * @return el MCD de number1 y number2
   */
  public static int mcd(int number1, int number2) {
    // TODO: Implementa el cálculo recursivo del MCD de number1 y number2

      if (number1 <= 0) return number2;
      if (number2 <= 0) return number1;
      if (number1 == number2) return number1;
      //       Ejemplo:
      //        n1 = 80 ; n2 = 20
      //       (80 - 20) / 20
      if (number1 > number2) return mcd((number1 - number2), number2);
      //       Ejemplo:
      //       n1 = 20; n2 = 80
      //       20 / (80 - 20)
      return mcd((number1), (number2- number1));

      
  }

  /**
   * exercise 5
   *
   * @param str String usado para invertir caracteres.
   * @return el string invertido.
    */
  public static String invert(String str) {

    if (str.length() <= 1) return str;
    return (invert(str.substring(1)) + str.charAt(0));

  }

  /**
   * exercise 6
   *
   * @param values el array usado para sumar los valores.
   * @return suma todos los valores del array.
   */
  public static int addValuesWithFor(int[] values) {

    if (values.length == 0) return 0; // si la lista no tiene valores dentro devolvemos 0

    int[] remainingValues = new int[values.length - 1];

    for (int i=0; i < remainingValues.length; i++) {
      remainingValues[i] = values[i+1];
    }

    return values[0] + addValuesWithFor(remainingValues);
  }


  public static int addValues(int[] values) {
    if (values.length == 0) return 0; // si la lista no tiene valores dentro devolvemos 0
    if (values.length == 1) return values[0];
    return addValuesInternal(values, 0);    
  }


  public static int addValuesInternal(int[] values, int index) {
    if (values.length <= index) return 0;
    return values[index] + addValuesInternal(values, ++index);
  }



  /**
   * exercise 7
   *
   * @param values array usado para el proceso de inversion.
   */
  public static void invertArray(int[] values) {
    if ((values.length <= 1)) return;
    invertArrayInternal(values, 0);
  }

  public static void invertArrayInternal(int[] values, int index) {

    if (index >= values.length / 2) return; // cruzar medio array implica que hice todos los cambios

    int invertedIndex = values.length - index - 1;

    int temp = values[index];
    values[index] = values[invertedIndex];
    values[invertedIndex] = temp;

    invertArrayInternal(values, index + 1);

  }

  /**
   * exercise 8
   *
   * @param values array usado para encontrar el entero menor.
   * @return el menor entero del array.
   */
  public static int minimum(int[] values) {
    return minimumInternal(values, 0, values[0]); // por defecto, el mínimo es el primer valor observado
    // checkValueHere is the start index
  }

  public static int minimumInternal(int[] values, int checkValueHere, int min) {

    if (checkValueHere >= values.length) return min;
    if (values[checkValueHere] < min) min = values[checkValueHere];

    return minimumInternal(values, ++checkValueHere, min);
    }

  /**
   * exercise 9
   *
   * @param values array usado para la busqueda binaria.
   * @param number el numero a buscar.
   * @return el indice de number en el array o -1 si no está.
   */
  public static int binarySearch(double[] values, double number) {
    return binarySearchHelper(values, number, 0, values.length - 1);
  }

  public static int binarySearchHelper(double[] values, double number, int start, int end) {

    int now_start_index = ((end - start)/ 2);
    double gotten_number = values[now_start_index];

    if (gotten_number == number) return now_start_index;
    // esta comprobación se hace de segunda por si acaso está superpuesto en un array de un valor
    if (end - start <= 1) return -1; // fail

    if (number > gotten_number) return binarySearchHelper(values, gotten_number, start + 1, now_start_index);

    return binarySearchHelper(values, now_start_index, start, end - 1);
  }

  /**
   * exercise 10
   *
   * @param <T> Tipo de los elementos contenidos en el Stack.
   * @param stack la pila a copiar.
   * @return una nueva pila con los mismos elementos que la original.
   */

  public static <T> Stack<T> copyStack(Stack<T> stack) {
    // caso base
    if (stack.isEmpty()) return new Stack<>();
    
    // saco elemento superior
    T element = stack.pop();

    // cada vez que llamo a este elemento, aplazo el push hasta que vacío el stack
    Stack<T> newStack = copyStack(stack);

    stack.push(element);
    newStack.push(element);

    return newStack;

  }
}
