package es.uvigo.esei.aed2.activity9;

import java.util.Arrays;

// Runs testPlaceQueens.
public class Driver {
  public static void main(String[] args) {
    int[] board = new int[8];
    boolean found = BacktrackingAlgorithm.placeQueens(0, board);
    System.out.println("placeQueens=" + found + " " + Arrays.toString(board));
  }
}
