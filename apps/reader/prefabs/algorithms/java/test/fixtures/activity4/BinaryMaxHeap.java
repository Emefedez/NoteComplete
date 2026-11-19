package es.uvigo.esei.aed2.activity4;

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

public class BinaryMaxHeap<T extends Comparable<T>> implements MaxHeap<T> {

  // Exercise 1
  private final ArrayList<T> arrayHeap;

  public BinaryMaxHeap() {
    this.arrayHeap = new ArrayList<>();
    this.arrayHeap.add(0, null);
  }

  /**
   * Comprueba si el heap está vacío.
   *
   * @return <code>true</code> cuando el heap está vacío y <code>false</code> en
   * caso contrario.
   */
  @Override
  public boolean isEmpty() {
    return this.arrayHeap.size() <= 1;
  }

  /**
   * Recupera el mayor elemento del heap.
   *
   * @return el elemento mayor del heap.
   * @throws HeapEmptyException cuando el heap está vacío.
   */
  @Override
  public T getMaxValue() throws HeapEmptyException {
    if (this.isEmpty()) throw new HeapEmptyException();
    return this.arrayHeap.get(1);
  }

  /**
   * Elimina y devuelve el elemento mayor del heap.
   *
   * @return el elemento mayor del heap.
   * @throws HeapEmptyException cuando el heap está vacío.
   */
  public T removeMaxValueMateo() throws HeapEmptyException {
    if (this.arrayHeap.isEmpty()) throw new HeapEmptyException();
    // T maxValue = this.arrayHeap.get(1);
    return sinkMateo(1);
  }

   /**
   * Mueve el elemento en la posición {@code hollow} hacia arriba en el heap
   * hasta que se cumpla la propiedad de ordenación.
   *
   * @param hollow la posición del elemento a mover.
   */
  private T sinkMateo(int valuePos) {
    sinkHelper(valuePos, valuePos*2, valuePos*2 + 1);
    return this.arrayHeap.remove(this.arrayHeap.size());
  }

  private T sinkHelper(int valPos, int childLeftPos, int childRightPos) throws HeapEmptyException {
    T dadValue = this.arrayHeap.get(valPos);
    if (this.arrayHeap.size() == valPos) return dadValue;

    // defino hijos
    T childLeft = this.arrayHeap.get(childLeftPos);
    T childRight = this.arrayHeap.get(childRightPos);
    T childGrown = null;
    int childGrownPos = -1;

    // identifico hijo mayor
    if (childLeft.compareTo(childRight) >= 0) {
      childGrown = childLeft;
      childGrownPos = childLeftPos;
    } 
    else {
      childGrown = childLeft;
      childGrownPos = childRightPos;
    }  

    // intercambio hijo mayor con padre
    
    if (dadValue.compareTo(childGrown) >= 0) return dadValue;

    this.arrayHeap.set(childGrownPos, dadValue);
    this.arrayHeap.set(valPos, childGrown);

    // el valor del original padre está ahora donde childGrown
    return sinkHelper(childGrownPos, childGrownPos*2, childGrownPos*2 + 1);
  }

  @Override
  public T removeMaxValue() throws HeapEmptyException {
    if (this.isEmpty()) throw new HeapEmptyException();

    T value = this.arrayHeap.get(1);
    T last = this.arrayHeap.remove(this.arrayHeap.size()-1);
    if (this.arrayHeap.size() > 1) {
      this.arrayHeap.set(1, last);
      sink(1); 
    }
    return value;
  }

  private void sinkIterative(int hollow) {
    int child = hollow*2;
    T value = this.arrayHeap.get(hollow);
    boolean end = false;

    while (child <= this.arrayHeap.size() - 1 && !end) {
      if (child < this.arrayHeap.size()-1 // también tengo hijo derecho
          && this.arrayHeap.get(child+1).compareTo(this.arrayHeap.get(child))>0) { 
        child++; //si el hijo derecho es mayor, lo hacemos el principal
      }
      if (this.arrayHeap.get(child).compareTo(value) > 0) {
        this.arrayHeap.set(hollow, this.arrayHeap.get(child));
        this.arrayHeap.set(child, value);
        child = hollow*2;
      }
      else {
        end = true;
      }
    }
  }

  private void sink(int hollow) {
    T childLeft = null;
    T childRight = null;
    int childGrownPos = -1;
    // si no la posicion del padre es equivalente al tamaño del árbol, volvemos
    // if (this.arrayHeap.size() -1 == hollow) return;
    // si tiene un unico hijo, será izquierdo
    // posibles posiciones

    T dadValue = this.arrayHeap.get(hollow);

    int childLeftPos = hollow*2;
    int childRightPos = (hollow*2) + 1;
    // defino hijos
    if (childLeftPos < this.arrayHeap.size()) {
      childLeft = this.arrayHeap.get(childLeftPos);
      if (childRightPos < this.arrayHeap.size()) {
        childRight = this.arrayHeap.get(childRightPos);
      }
      // el izquierdo es mayor
      if (childRight == null || childLeft.compareTo(childRight) >= 0) {
        childGrownPos = childLeftPos;
      } 
      else { 
        childGrownPos = childRightPos;
      }

      this.arrayHeap.set(hollow, this.arrayHeap.get(childGrownPos));
      this.arrayHeap.set(childGrownPos, dadValue);
      sink(childGrownPos);  
    }  
  }

  /**
   * Añade un valor al heap.
   *
   * @param value el elemento a añadir.
   * @throws NullPointerException si el valor es <code>null</code>.
   */
  @Override
  public void add(T value) throws NullPointerException {
    if (value == null) throw new NullPointerException();
    this.arrayHeap.add(arrayHeap.size(), value); // empezamos en pos=1, no en pos=0
    addHelper(this.arrayHeap.size() - 1, (this.arrayHeap.size()-1) / 2);
  }

  private void addHelper(int valuePos, int dadValuePos) {
    if (valuePos == 1) return;

    T valueDad = this.arrayHeap.get(dadValuePos);
    T valueChild = this.arrayHeap.get(valuePos);
    if (valueDad.compareTo(valueChild) >= 0) return;
    
    this.arrayHeap.set(dadValuePos, valueChild);
    this.arrayHeap.set(valuePos, valueDad);

    addHelper(dadValuePos, dadValuePos/2);
  }

  public void addReyes(T value) throws NullPointerException {
    if (value == null) throw new NullPointerException();
    arrayHeap.addLast(value);
    int child = this.arrayHeap.size() - 1;

    while (child > 1 && this.arrayHeap.get(child/2).compareTo(value) < 0) {
      this.arrayHeap.set(child, this.arrayHeap.get(child/2));
      this.arrayHeap.set(child/2, value);
      child = child / 2;
    }

  }
  /**
   * Elimina los valores del heap, convirtiéndolo en un heap vacío.
   */
  @Override
  public void clear() {
    this.arrayHeap.clear();
    this.arrayHeap.add(0, null);
  }

  /**
   * Añade un valor al heap sin mantener la propiedad de ordenacion
   *
   * @param value el elemento a añadir
   * @throws NullPointerException si el valor es <code>null</code>
   */
  @Override
  public void insert(T value) throws NullPointerException {
    if (value == null) throw new NullPointerException();
    this.arrayHeap.add(value);
  }

  /**
   * Restablece el orden en el montículo binario
   */
  @Override
  public void orderHeap() {
    // con n = size() - 1 elementos (la posición 0 es null), si divido el array en dos:
    //  - la primera mitad (1 .. n/2) son los posibles padres: tienen al menos hijo izquierdo (2i <= n)
    //  - la segunda mitad (n/2 + 1 .. n) son hojas: su hijo sería 2i > n, así que ya son heaps y no hace falta sinkearlas
    // cualquier padre puede estar desordenado respecto a lo agregado por insert, así que se sinkean todos,
    // HACIA ATRÁS (del último padre a la raíz): sink(i) solo funciona si los subárboles de i ya son heaps.
    // el último padre exacto es (size() - 1) / 2; size() / 2 a veces es una hoja de más, que sink deja igual.
    int sinkCuttof = this.arrayHeap.size()/2;
    for (int i=sinkCuttof; i>0; i--) {
      sinkMateo(i);
    }
  }



  public T removeMaxValue2() throws HeapEmptyException {
    if (this.arrayHeap.size() <= 1) throw new HeapEmptyException();
    return sink2CompactWrapper();

  }

// sink mueve el elemento en la posicion i hacia abajo en el heap hasta que cumpla la propiedad de ordenación
  private void sink2(int i) {
      if ( i > this.arrayHeap.size()) return; // es el último sitio
      int dadPos = i;
      T dadValue = this.arrayHeap.get(dadPos);
      int leftChildPos = 2*i;
      int rightChildPos = leftChildPos + 1;
      boolean leftChildExists;
      boolean rightChildExists;
      leftChildExists = (leftChildPos < this.arrayHeap.size());
      rightChildExists = (rightChildPos < this.arrayHeap.size());
      T leftValue = null;
      T rightValue = null;
      int biggerChildPos = dadPos;
      T biggerChildVal = dadValue;

      if (leftChildExists) leftValue = this.arrayHeap.get(leftChildPos);
      if (rightChildExists) rightValue = this.arrayHeap.get(rightChildPos);

      // existen ambos hijos
      if (leftChildExists && rightChildExists) {
        if (leftValue.compareTo(rightValue) >= 0) {
          biggerChildPos = leftChildPos;
          biggerChildVal = leftValue;
        }
        else {
          biggerChildPos = rightChildPos;
          biggerChildVal = rightValue;
        }
      }
      if (leftChildExists && !rightChildExists) {
        biggerChildPos = leftChildPos;
        biggerChildVal = leftValue;
      }
      if (!leftChildExists && rightChildExists) {
        biggerChildPos = rightChildPos;
        biggerChildVal = rightValue;
      }
      
      if (biggerChildVal.compareTo(dadValue) > 0) {
        exchangeNodes(biggerChildPos, dadPos);
        sink2(biggerChildPos);
      }
  }

  // sink2 con los mismos pasos, sin casos imposibles ni variables repetidas
  private void sink2OGRemaster(int i) {
    int leftChildPos = 2 * i;
    int rightChildPos = leftChildPos + 1;
    boolean leftChildExists = leftChildPos < this.arrayHeap.size();
    boolean rightChildExists = rightChildPos < this.arrayHeap.size();
    if (!leftChildExists) return; // es hoja: no hay nada debajo

    // por defecto el mayor es el izquierdo; el derecho solo si existe y es mayor
    int biggerChildPos = leftChildPos;
    if (rightChildExists && this.arrayHeap.get(rightChildPos).compareTo(this.arrayHeap.get(leftChildPos)) > 0) {
      biggerChildPos = rightChildPos;
    }

    T dadValue = this.arrayHeap.get(i);
    T biggerChildValue = this.arrayHeap.get(biggerChildPos);
    if (biggerChildValue.compareTo(dadValue) > 0) {
      exchangeNodes(biggerChildPos, i);
      sink2OGRemaster(biggerChildPos);
    }
  }

  private void sink2Compact(int i) {
    int child = 2 * i;
    if (child >= this.arrayHeap.size()) return;                                   // no hay hijo izquierdo
    if ((child + 1 < this.arrayHeap.size()) && arrayHeap.get(child + 1).compareTo(arrayHeap.get(child)) > 0) child++;
    if (arrayHeap.get(child).compareTo(arrayHeap.get(i)) < 0) return;   // el padre ya es mayor o igual

    exchangeNodes(child, i);
    sink2Compact(child);
}

  private T sink2CompactWrapper() {
    T max = this.arrayHeap.get(1);                               // leemos el valor del actual máximo
    T last = this.arrayHeap.remove(this.arrayHeap.size() - 1);   // guardamos el último como elemento
    if (this.arrayHeap.size() > 1) {                             // si no se cumpliera, eran sólo 2
      this.arrayHeap.set(1, last);                               // el último tapa el hueco de la raíz
      sink2Compact(1);                                           // y se hunde desde la raíz
    }
    return max; 
  }

  private void exchangeNodes(int sinkingPos, int surfacingPos) {
      T sinkingVal = this.arrayHeap.get(sinkingPos);
      T surfacingVal = this.arrayHeap.get(surfacingPos);
        this.arrayHeap.set(surfacingPos, sinkingVal);
        this.arrayHeap.set(sinkingPos, surfacingVal);
  }
}