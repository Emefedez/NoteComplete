package es.uvigo.esei.aed2.activity8;

import es.uvigo.esei.aed2.graph.AdjacencyList;
import es.uvigo.esei.aed2.graph.Graph;
import es.uvigo.esei.aed2.graph.Vertex;
import es.uvigo.esei.aed2.map.Map;

// Runs testDijkstra and testPrim (GRAPH_TRAVELLER_PRIM from GreedyRepository).
public class Driver {
  public static void main(String[] args) {
    String[] names = { "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX" };
    Graph<String, Integer> graph = new AdjacencyList<>();
    for (String n : names) graph.addVertex(new Vertex<>(n));
    String[][] edges = { { "ONE", "TWO", "3" }, { "TWO", "THREE", "7" }, { "THREE", "FOUR", "5" }, { "TWO", "SIX", "10" },
      { "ONE", "SIX", "5" }, { "THREE", "FIVE", "1" }, { "SIX", "FOUR", "2" }, { "SIX", "THREE", "8" }, { "FOUR", "FIVE", "6" } };
    for (String[] e : edges) {
      graph.addEdge(new Vertex<>(e[0]), new Vertex<>(e[1]), Integer.valueOf(e[2]));
      graph.addEdge(new Vertex<>(e[1]), new Vertex<>(e[0]), Integer.valueOf(e[2]));
    }
    Map<Vertex<String>, Integer> distances = GreedyAlgorithm.dijkstra(graph, new Vertex<>("ONE"));
    StringBuilder sb = new StringBuilder();
    for (String n : names) sb.append(n).append('=').append(distances.get(new Vertex<>(n))).append(' ');
    System.out.println("dijkstra " + sb.toString().trim());
    Graph<String, Integer> tree = GreedyAlgorithm.prim(graph, new Vertex<>("SIX"));
    System.out.println("prim vertices=" + tree.numberOfVertices() + " edges=" + tree.getEdges().size());
    String[][] expected = { { "ONE", "TWO", "3" }, { "SIX", "ONE", "5" }, { "FOUR", "THREE", "5" }, { "THREE", "FIVE", "1" }, { "SIX", "FOUR", "2" } };
    boolean all = true;
    for (String[] e : expected) all &= tree.containsEdge(new Vertex<>(e[0]), new Vertex<>(e[1]), Integer.valueOf(e[2]));
    System.out.println("prim has the expected edges=" + all);
  }
}
