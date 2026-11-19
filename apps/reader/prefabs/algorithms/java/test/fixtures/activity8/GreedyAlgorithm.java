package es.uvigo.esei.aed2.activity8;

// Dijkstra and Prim for the simulator's tests, written in the course's style against the
// course's Graph/Map TADs (the activities repo leaves these exercises as stubs).

import java.util.HashSet;
import java.util.Set;

import es.uvigo.esei.aed2.graph.AdjacencyList;
import es.uvigo.esei.aed2.graph.Edge;
import es.uvigo.esei.aed2.graph.Graph;
import es.uvigo.esei.aed2.graph.Vertex;
import es.uvigo.esei.aed2.map.HashMap;
import es.uvigo.esei.aed2.map.Map;

public class GreedyAlgorithm {

  // Exercise 2
  public static <T> Graph<T, Integer> prim(Graph<T, Integer> graph, Vertex<T> vertex) {
    Graph<T, Integer> tree = new AdjacencyList<>();
    Set<Vertex<T>> inTree = new HashSet<>();
    tree.addVertex(vertex);
    inTree.add(vertex);
    while (inTree.size() < graph.numberOfVertices()) {
      Edge<T, Integer> best = null;
      for (Edge<T, Integer> edge : graph.getEdges()) {
        if (inTree.contains(edge.getSource()) && !inTree.contains(edge.getTarget())
            && (best == null || edge.getLabel() < best.getLabel())) {
          best = edge;
        }
      }
      if (best == null) break; // not connected
      tree.addVertex(best.getTarget());
      tree.addEdge(best.getSource(), best.getTarget(), best.getLabel());
      inTree.add(best.getTarget());
    }
    return tree;
  }

  // Exercise 3
  public static <T> Map<Vertex<T>, Integer> dijkstra(Graph<T, Integer> graph, Vertex<T> vertex) {
    Map<Vertex<T>, Integer> distances = new HashMap<>();
    Set<Vertex<T>> visited = new HashSet<>();
    for (Vertex<T> v : graph.getVertices()) {
      distances.add(v, Integer.MAX_VALUE);
    }
    distances.add(vertex, 0);
    while (visited.size() < graph.numberOfVertices()) {
      Vertex<T> current = null;
      for (Vertex<T> v : graph.getVertices()) {
        if (!visited.contains(v) && (current == null || distances.get(v) < distances.get(current))) {
          current = v;
        }
      }
      if (distances.get(current) == Integer.MAX_VALUE) break; // the rest is unreachable
      visited.add(current);
      for (Vertex<T> adjacent : graph.getAdjacentsVertex(current)) {
        int newDistance = distances.get(current) + weight(graph, current, adjacent);
        if (newDistance < distances.get(adjacent)) {
          distances.add(adjacent, newDistance);
        }
      }
    }
    return distances;
  }

  private static <T> int weight(Graph<T, Integer> graph, Vertex<T> source, Vertex<T> target) {
    for (Edge<T, Integer> edge : graph.getEdges()) {
      if (edge.getSource().equals(source) && edge.getTarget().equals(target)) return edge.getLabel();
    }
    return Integer.MAX_VALUE;
  }
}
