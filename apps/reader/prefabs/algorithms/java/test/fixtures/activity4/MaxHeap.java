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

public interface MaxHeap<T extends Comparable<T>> {

  /**
   * Comprueba si el heap está vacío.
   * 
   * @return <code>true</code> cuando el heap está vacío y <code>false</code> en
   *         caso contrario.
   */
  public boolean isEmpty();

  /**
   * Recupera el mayor elemento del heap.
   * 
   * @return el elemento mayor del heap.
   * @throws HeapEmptyException cuando el heap está vacío.
   */
  public T getMaxValue() throws HeapEmptyException;

  /**
   * Elimina y devuelve el elemento mayor del heap.
   * 
   * @return el elemento mayor del heap.
   * @throws HeapEmptyException cuando el heap está vacío.
   */
  public T removeMaxValue() throws HeapEmptyException;

  /**
   * Añade un valor al heap.
   * 
   * @param value el elemento a añadir.
   * @throws NullPointerException si el valor es <code>null</code>.
   */
  public void add(T value) throws NullPointerException;

  /**
   * Elimina los valores del heap, convirtiéndolo en un heap vacío.
   */
  public void clear();

  //exercise 2
  /**
   * Añade un valor al heap sin mantener la propiedad de ordenacion
   * @param value el elemento a añadir
   * @throws NullPointerException si el valor es <code>null</code>
   */
  public void insert(T value) throws NullPointerException;
  
  /**
   * Restablece el orden en el montículo binario
   */
  public void orderHeap();
}
