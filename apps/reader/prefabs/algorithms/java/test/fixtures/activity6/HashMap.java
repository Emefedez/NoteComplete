package es.uvigo.esei.aed2.activity6.HashMap;

import java.util.Iterator;
import java.util.LinkedList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.function.BiConsumer;

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

import es.uvigo.esei.aed2.map.Map;

public class HashMap<K,V> implements Map<K,V> {
  private static final int CAPACITY = 50;

  private int size;
  private List<Pair<K, V>>[] map;

  public HashMap() {
    this(CAPACITY);
  }

  @SuppressWarnings("unchecked")
  private HashMap(int capacity) throws IllegalArgumentException {
    if (capacity < 1) throw new IllegalArgumentException();
    this.size = 0; // 0 cosas dentro
    this.map = (List<Pair<K,V>>[]) new List[capacity];
    
    for(int i = 0; i < capacity; i++){
      this.map[i] = new LinkedList<>();
    }
  }

  

  private int calculateIndex(K key) {
    int hashCode = key.hashCode();
    return Math.abs(hashCode % map.length);
  }

  @Override
  public int size() {
    return this.size;
  }

  @Override
  public V get(K key) {
    if (key == null) return null;
   int hashed = this.calculateIndex(key); //calcula el índice del array donde se encuentra la lista de pares (key, value) que contiene la clave key
    if (this.map[hashed].isEmpty()) return null; //si no hay pares en ese índice, devuelve null

   List<Pair<K,V>> ourHash = this.map[hashed]; //recupera la lista de pares (key, value) que contiene la clave key
   int hashListSize = ourHash.size();//recupera el tamaño de la lista de pares (key, value) que contiene la clave key
   for (int i=0; i<hashListSize; i++) {//recorre la lista de pares (key, value) que contiene la clave key
    if (ourHash.get(i).getKey().equals(key)) return ourHash.get(i).getValue(); //si encuentra la clave key, devuelve el valor asociado a esa clave
   }

   return null;
  }

  @Override
  public void add(K key, V value) throws NullPointerException {
    if (key == null) throw new NullPointerException();

    int hashed = this.calculateIndex(key);
    List<Pair<K, V>> bucket = this.map[hashed];

    for (Pair<K, V> pair : bucket) {
      if (pair.getKey().equals(key)) {
        pair.setValue(value);
        return;
      }
    }

    bucket.add(new Pair<>(key, value));
    this.size++;
  }

  //elimina la clave de map y su valor asociado, el cual se retorna. SI la clave no existe devuelve null
  @Override
  public V remove(K key) {
    if(key == null){
      return null;
    }
    int hashed = calculateIndex(key); //calculo el indice de la clave, para saber en qué lista del array map puede estar la clave
    //ahora obtengo la lista correspondiente al indice de la clave
    List<Pair<K, V>> lista = map[hashed];
    
    for(int i = 0; i < lista.size(); i++){
      K searchedKey = lista.get(i).getKey();
      if(searchedKey.equals(key)){
        V foundValue = lista.get(i).getValue();
        lista.remove(i);
        this.size--;

        return foundValue;
      }
    }

    return null;
    
  }


  //devuelve un conjunto con todas las clvaes del map
  @Override
  public Set<K> getKeys() {
    Set<K> keysSet = new HashSet<>();
    for (List<Pair<K, V>> lista : this.map) {
      for (Pair<K, V> pair : lista) {
        keysSet.add(pair.getKey());
      }
    }
    return keysSet;
  }

  @Override
  public Iterator<V> getValues() {
    List<V> values = new LinkedList<>();
    for (List<Pair<K, V>> bucket : this.map) {
      for (Pair<K, V> pair : bucket) {
        values.add(pair.getValue());
      }
    }
    return values.iterator();
  }

  @Override
  public void clear() {
    for(List<Pair<K, V>> list : map){
      list.clear();
    }
    size = 0;
  }

  @Override
  public void forEach(BiConsumer<K, V> action){ 
    for(List<Pair<K, V>> list : map){
      for (Pair<K, V> pair : list) {
        action.accept(pair.getKey(), pair.getValue());
      }
    }
  }

  private static class Pair<K, V> {

    private final K k;
    private V v;

    public Pair(K k, V v) {
      this.k = k;
      this.v = v;
    }

    public K getKey() {
      return k;
    }

    public V getValue() {
      return v;
    }

    public void setValue(V v) {
      this.v = v;
    }

    @Override
    public boolean equals(Object other) {
      if (other instanceof Pair) {
        Pair<?, ?> hp = (Pair<?, ?>) other;
        return this.k.equals(hp.k) && this.v.equals(hp.v);
      } else {
        return false;
      }
    }

    @Override
    public int hashCode() {
      return Objects.hashCode(this.k) ^ Objects.hashCode(this.v);
    }
  }
  
}