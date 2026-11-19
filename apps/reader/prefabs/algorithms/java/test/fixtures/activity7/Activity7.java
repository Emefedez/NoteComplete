package es.uvigo.esei.aed2.activity7;

import java.nio.channels.SeekableByteChannel;

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

import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.List;
import java.util.Set;
import java.util.Vector;

import es.uvigo.esei.aed2.activity6.mapofmap.MapOfMap;
import es.uvigo.esei.aed2.graph.Graph;
import es.uvigo.esei.aed2.graph.Vertex;
import es.uvigo.esei.aed2.map.Map;
import es.uvigo.esei.aed2.map.HashMap;
import es.uvigo.esei.aed1.tads.queue.LinkedQueue;
import es.uvigo.esei.aed1.tads.queue.Queue;

public class Activity7 {

  // exercise 1
  public static <T, E> Set<Vertex<T>> getPredecessors(Graph<T, E> graph, Vertex<T> vertex) {
    Set<Vertex<T>> toret = new HashSet<>();
    for (Vertex<T> vertice : graph.getVertices()) {
      for (Vertex<T> adyacente : graph.getAdjacentsVertex(vertice)) {
        if (adyacente.equals(vertex))
          toret.add(vertice);
      }
    }
    return toret;
  }

  // exercise 2
  public static <T, E> boolean isRegular(Graph<T, E> graph) {
    if (graph.isEmpty())
      return true;
    Set<Vertex<T>> vertices = graph.getVertices();
    int adyacentes = -1;
    for (Vertex<T> vertice : vertices) {
      if (adyacentes == -1)
        adyacentes = graph.getAdjacentsVertex(vertice).size();
      else {
        if (graph.getAdjacentsVertex(vertice).size() != adyacentes)
          return false;
      }
    }
    return true;
  }

  // exercise 3
  public static <T, E> boolean isConnectedFromVertex(Graph<T, E> graph, Vertex<T> vertex) {
    if (graph.isEmpty())
      return false;
    Set<Vertex<T>> visited = new HashSet<>();
    dfs(graph, vertex, visited);

    return (visited.size() == graph.getVertices().size());
  }

  private static <T, E> void dfs(Graph<T, E> graph, Vertex<T> vertex, Set<Vertex<T>> visited) {
    visited.add(vertex);
    for (Vertex<T> adj : graph.getAdjacentsVertex(vertex)) {
      if (!visited.contains(adj))
        dfs(graph, adj, visited);
    }
  }

  // exercise 4
  // volver antes
  public static <T, E> boolean thereIsPathBetweenVertices(Graph<T, E> graph, Vertex<T> source, Vertex<T> target) {
    if (graph.getVertices().contains(source)) {
      return pathDFSHelper(graph, source, new HashSet<>(), target); // source ya visitado, contenido y existente
    } else
      return false;
  }

  private static <T, E> boolean pathDFSHelper(Graph<T, E> graph, Vertex<T> vertex, Set<Vertex<T>> visited,
      Vertex<T> originalTarget) {
    visited.add(vertex);

    if (vertex.equals(originalTarget)) return true;

    for (Vertex<T> ady : graph.getAdjacentsVertex(vertex)) {
      if (!visited.contains(ady) && pathDFSHelper(graph, ady, visited, originalTarget)) return true;
    }

    return false;
  }

  // exercise 5
  public static <T, E> boolean isACycle(Graph<T, E> graph, List<Vertex<T>> path) {
    // 1. Primer y último vértice de la lista son iguales
    // 2. (v1,v3), (v3,v4), (v4,v1) , sacar las conexiones necesarias
    // 3. todos los nodos != primero && != ultimo diferentes
    if (!path.getFirst().equals(path.getLast())) return false;
    Map<Vertex<T>, Vertex<T>> vertexMap = mapFromListGenerator(path); // cada vértice de entrada tiene asociado su vértice de salida, no se pueden repetir keys (vértices de entrada). Se machacan las llaves "repetidas" en un mapa
    if (vertexMap == null) return false;
    return true;
  }

  private static <T> Map<Vertex<T>, Vertex<T>> mapFromListGenerator(List<Vertex<T>> path) {
    Map<Vertex<T>, Vertex<T>> vertexMap = new HashMap<>();
    // saco en pares, desplazando uno
    for (int vertexIndex = 0; vertexIndex < path.size() - 1; vertexIndex++) {
      if (vertexMap.get(path.get(vertexIndex)) != null) return null; //si la llave ya existe como llave, hay repetición
      else vertexMap.add(path.get(vertexIndex), path.get(vertexIndex + 1));
    }
    return vertexMap;
  }

  //TODO: repetir, de Alphy
  public static <T, E> boolean isACycleAlphy(Graph<T, E> graph, List<Vertex<T>> path) {
    // en el grafo
    if (!path.getFirst().equals(path.getLast()))
      return false;
    Set<Vertex<T>> visited = new HashSet<>();
    for (int i = 0; i < path.size() - 1; i++) {
      visited.add(path.get(i));
      if (!graph.getAdjacentsVertex(path.get(i)).contains(path.get(i + 1)))
        return false;
      if (i != path.size() - 2 && visited.contains(path.get(i + 1)))
        return false;
    }
    return true;
  }

  // exercise 6
  // TODO: repetir, este es hecho por Alphy
  public static <T, E> int numberOfConnectedComponentsAlphy(Graph<T, E> graph) {
    int conjuntos = 0;
    Set<Vertex<T>> vertices = graph.getVertices();
    Set<Vertex<T>> visited = new HashSet<>();
    
    for (Vertex<T> vertice : vertices) {
      if (!visited.contains(vertice)){
        dfs(graph, vertice, visited);
        conjuntos++;
      }
    }
    return conjuntos;
  }

  public static <T, E> int numberOfConnectedComponents(Graph<T, E> graph) {
    int visitedVertices = 0;
    Set<Vertex<T>> visited = graph.getVertices();
    Set<Vertex<T>> ready = new HashSet<>();

    for (Vertex<T> vertex : visited) {
      if (!ready.contains(vertex)) {
        dfs(graph, vertex, ready);
        visitedVertices++;
      } 
    }
    return visitedVertices;
  }
  private static <T, E> void dfsReimplemented(Graph<T, E> graph, Vertex<T> vertex, Set<Vertex<T>> visited) {
    visited.add(vertex);
    for (Vertex<T> adjVertex : graph.getAdjacentsVertex(vertex)) {
      if (!visited.contains(adjVertex)) dfs(graph, adjVertex, visited);
    }
  }

  public static <T,E> List<Vertex<T>> bfsSlowReimplemented(Graph<T,E> graph, Vertex<T> vertex) {
    if (vertex == null) throw new NullPointerException();
    List<Vertex<T>> vertexList = new LinkedList<>();
    Set<Vertex<T>> adjSet = new HashSet<>();

    adjSet.add(vertex);
    vertexList.addLast(vertex);
    
    for (int i = 0; i < vertexList.size(); i++) {
        adjFinder(graph, vertexList.get(i), adjSet, vertexList);
    }
    return vertexList;

    
  }
  

  protected static <T,E> List<Vertex<T>> adjFinder(Graph<T,E> graph, Vertex<T> vertex, Set<Vertex<T>> visited, List<Vertex<T>> currentList) {
    if (graph.getAdjacentsVertex(vertex) == null) return new LinkedList<>();
    Set<Vertex<T>> vertexSet = graph.getAdjacentsVertex(vertex);
    Iterator<Vertex<T>> vSetIterator = vertexSet.iterator();

    while (vSetIterator.hasNext()) {
      Vertex<T> v = vSetIterator.next();
      if (!visited.contains(v)) {
        visited.add(v);
        currentList.addLast(v);
      }
    }

    return currentList;
  }


  // exercise 7
  public static <T, E> Map<Vertex<T>, Integer> BFSShortestPath(Graph<T, E> graph, Vertex<T> start) {
    /* 
     * 1. Se visita el vértice del que se parte, v.
     * 
     * 2. Se visitan todos sus adyacentes que no estuvieran ya visitados,
     * y así sucesivamente, visitmos todos los adyacentes antes de pasar a otro vértice.
     * 
     * 3. La cantidad de nodos en el camino hasta el final del grafo es equivalente a la cantidad de veces que pasamos al nivel próximo (imaginado como un árbol).
     * -> Entonces, si popeamos el vértice del grafo por primera vez en un nivel, deberíamos poder
     *    identificar que hemos avanzado en nuestro recorrido
     * -> La mejor forma de pensarlo es guardando la distancia desde start de cada nodo, y obtenerla del *    último
     */

    Map<Vertex<T>, Integer> visited = new HashMap<>();
    Queue<Vertex<T>> toVisit = new LinkedQueue<>();

    visited.add(start, 0); // el propio start
    toVisit.add(start);

    do {
      Vertex<T> current = toVisit.remove();
      int distanceFromStart = visited.get(current); // en el inicial, es 0

      // para todos los vértices 
      for (Vertex<T> adjacentVertex : graph.getAdjacentsVertex(current)) { 
        if (visited.get(adjacentVertex) == null) {
          visited.add(adjacentVertex, distanceFromStart + 1);
          toVisit.add(adjacentVertex);
        }
      }

    } while (!toVisit.isEmpty());

    // SE DEBE HACER CON COLA Y VISITAR, NOS DA CON QUE TIENE CONEXION CADA, Y LO IDEAL SERIA USAR UN MAPA DONDE TENGAMOS EL NODO + INT, REPRESENTANDO EL ENTERO CUANTO HAY QUE MOVERSE DESDE EL NODO INICIAL A LA LLAVE DEL MAPA

    return visited;
  }


  public static <T,E> List<Vertex<T>> bfsReimplemented(Graph<T,E> graph, Vertex<T> vertex) {
    if (vertex == null) throw new NullPointerException();
    Set<Vertex<T>> visited = new HashSet<>();
    Queue<Vertex<T>> toExplore = new LinkedQueue<>();
    List<Vertex<T>> list = new LinkedList<Vertex<T>>();


    toExplore.add(vertex); // hay que ver sus hijos
    visited.add(vertex);

    do {
      Vertex<T> v = toExplore.remove();
      list.add(v);
      for (Vertex<T> adj : graph.getAdjacentsVertex(v)) {
        if (!visited.contains(adj)) {
          visited.add(adj);
          toExplore.add(adj);
        }
      }

    } while (!toExplore.isEmpty());

    return list;
  }


  /*
  public static <T,E> void bfs(Graph<T,E> graph, Vertex<T> vertex) {
    Set<Vertex<T>> visited = new HashSet<>();
    Queue<Vertex<T>> toExplore = new LinkedQueue<>();

    toExplore.add(vertex);
    visited.add(vertex);

    do {
      vertex = toExplore.remove();
      for (Vertex<T> ady : graph.getAdjacentsVertex(vertex)) {
        if (!visited.contains(ady)) {
          toExplore.add(ady);
          visited.add(ady);
        }
      }

    } while (!toExplore.isEmpty());

  }
  */
}
