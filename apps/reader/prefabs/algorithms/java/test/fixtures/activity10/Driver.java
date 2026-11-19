package es.uvigo.esei.aed2.activity10;

// Runs testQuickSelection and testMoveHanoiDiscs.
public class Driver {
  public static void main(String[] args) {
    int[] quickSelect = { 4, 2, 8, 12, 6, 9, 23, 43, 78, 14 };
    System.out.println("quickSelection(5)=" + DivideAndConquerAlgorithm.quickSelection(quickSelect, 5, 0, quickSelect.length - 1));
    System.out.print(DivideAndConquerAlgorithm.moveHanoiDiscs(3, "A", "B", "C"));
  }
}
