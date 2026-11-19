package es.uvigo.esei.aed2.activity7;

import java.util.List;
import es.uvigo.esei.aed2.graph.AdjacencyList;
import es.uvigo.esei.aed2.graph.Graph;
import es.uvigo.esei.aed2.graph.Vertex;

// Runs cases of Activity7TestCase (graphs from GraphRepository) and prints the results.
public class Driver {
  private static Graph<String, Integer> graph(String[] vertices, String[][] edges) {
    Graph<String, Integer> g = new AdjacencyList<>();
    for (String v : vertices) g.addVertex(new Vertex<>(v));
    for (String[] e : edges) g.addEdge(new Vertex<>(e[0]), new Vertex<>(e[1]), Integer.parseInt(e[2]));
    return g;
  }

  public static void main(String[] args) {
    Graph<String, Integer> empty = new AdjacencyList<>();
    Graph<String, Integer> cities = graph(new String[] { "Corunha", "Lugo", "Ourense", "Pontevedra" }, new String[][] {
      { "Lugo", "Corunha", "10" }, { "Corunha", "Ourense", "20" }, { "Lugo", "Pontevedra", "115" },
      { "Ourense", "Pontevedra", "100" }, { "Lugo", "Ourense", "100" }, { "Pontevedra", "Lugo", "115" }, { "Ourense", "Corunha", "20" } });
    Graph<String, Integer> topo2 = graph(new String[] { "A", "B", "C", "D" }, new String[][] {
      { "C", "A", "10" }, { "C", "B", "10" }, { "C", "D", "115" }, { "B", "D", "115" } });
    Vertex<String> co = new Vertex<>("Corunha"), ou = new Vertex<>("Ourense");
    System.out.println("predecessors(empty)=" + Activity7.getPredecessors(empty, co).isEmpty());
    System.out.println("predecessors(OU)=" + Activity7.getPredecessors(cities, ou));
    System.out.println("isRegular(empty)=" + Activity7.isRegular(empty) + " isRegular(cities)=" + Activity7.isRegular(cities));
    System.out.println("connected(empty,CO)=" + Activity7.isConnectedFromVertex(empty, co));
    System.out.println("connected(cities,CO)=" + Activity7.isConnectedFromVertex(cities, co));
    System.out.println("connected(topo2,B)=" + Activity7.isConnectedFromVertex(topo2, new Vertex<>("B")));
    System.out.println("connected(topo2,C)=" + Activity7.isConnectedFromVertex(topo2, new Vertex<>("C")));
    System.out.println("path(CO,OU)=" + Activity7.thereIsPathBetweenVertices(cities, co, ou));
    System.out.println("path(OU,CO)=" + Activity7.thereIsPathBetweenVertices(cities, ou, co));
    System.out.println("path(C,D)=" + Activity7.thereIsPathBetweenVertices(topo2, new Vertex<>("C"), new Vertex<>("D")));
    System.out.println("path(D,C)=" + Activity7.thereIsPathBetweenVertices(topo2, new Vertex<>("D"), new Vertex<>("C")));
    List<Vertex<String>> cycle = List.of(co, ou, new Vertex<>("Pontevedra"), new Vertex<>("Lugo"), co);
    System.out.println("isACycle=" + Activity7.isACycle(cities, cycle) + " alphy=" + Activity7.isACycleAlphy(cities, cycle));
    System.out.println("components(topo2)=" + Activity7.numberOfConnectedComponents(topo2) + " alphy=" + Activity7.numberOfConnectedComponentsAlphy(topo2));
    System.out.println("bfs(cities,CO)=" + Activity7.bfsReimplemented(cities, co));
    System.out.println("bfsSlow(cities,CO)=" + Activity7.bfsSlowReimplemented(cities, co));
    System.out.println("shortest(cities,CO)=" + Activity7.BFSShortestPath(cities, co).get(new Vertex<>("Pontevedra")));
  }
}
