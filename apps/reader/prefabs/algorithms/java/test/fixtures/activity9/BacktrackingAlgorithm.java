package es.uvigo.esei.aed2.activity9;

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
import java.util.List;
import java.util.Set;

public class BacktrackingAlgorithm {

  public static final int SUDOKU_DIMENSION = 9;
  public static final int PUZZLE_DIMENSION = 4; // Puzzle cuadrado

  // Exercise 1
  public static boolean giveChange(
    int amountReturned, Map<Integer, Integer> changeAvailable, Map<Integer, Integer> solution
  ) {

    return false;
  }

  // Exercise 2
  public static boolean fillUpFlashDrive(int capacityCD, Map<String, Integer> espacePrograms, Set<String> flashDrive) {

    return false;
  }

  // Exercise 3
  public static boolean subgroups(int[] values, int[] solution, int result, int index) {

    return false;
  }

  // Exercise 4
  private static boolean goodPlace(int queen, int column, int[] board) {
    // ¿Es amenaza colocar la reina queen en column, con las anteriores ?
    
    int previousQueen = 0;
    boolean isGood = true;
    
    while (previousQueen < queen && isGood) {
      if (board[previousQueen] == column) {
        isGood = false;
      } else if (Math.abs(previousQueen - queen) == Math.abs(board[previousQueen] - column)) {
        isGood = false;
      }
      previousQueen++;
    }
    
    return isGood;
  }

  public static boolean placeQueens(int queen, int[] board) {
    // solution written for the simulator's tests (the activities repo leaves it as a stub)
    if (queen == board.length) return true;
    for (int column = 0; column < board.length; column++) {
      if (goodPlace(queen, column, board)) {
        board[queen] = column;
        if (placeQueens(queen + 1, board)) return true;
      }
    }
    return false;
  }

  // Exercise 5
  public static boolean solveSudoku(int[][] board) {

    return true;
  }

  private static boolean canInsert(int[][] board, int i, int j, int value) {
    // Comprueba columna
    for (int a = 0; a < SUDOKU_DIMENSION; a++) {
      if (a != i && board[a][j] == value) {
        return false;
      }
    }
    // Comprueba fila
    for (int a = 0; a < SUDOKU_DIMENSION; a++) {
      if (a != j && board[i][a] == value) {
        return false;
      }
    }
    // Comprueba cuadrado
    int y = (i / 3) * 3; // me coloco en la primera fila del cuadrado a comprobar
    int x = (j / 3) * 3; // me coloco en la primera column del cuadrado a comprobar
    for (int a = 0; a < 3; a++) { // cuadrado tiene 3 filas
      for (int b = 0; b < 3; b++) { // cuadrado tiene 3 columns
        if (a != i && b != j && board[y + a][x + b] == value) {
          return false;
        }
      }
    }
    return true;
  }

  // Exercise 6
  public static boolean rehearseWords(char[][] maze, int positionX, int positionY, String word, int positionWord) {

    return false;
  }

  // Exercise 7
  public static boolean solvePuzzle(PuzzleCard[][] board, List<PuzzleCard> cards) {

    return true;
  }

  // Una vez que elimina una ficha del tablero, deja la ficha y el tablero en la situación anterior a colocarla
  private static void changeSidesPuzzleCards(PuzzleCard[][] board) {
    PuzzleCard[][] board2 = new PuzzleCard[board.length][board.length];

    for (int i = 0; i < PUZZLE_DIMENSION; i++) {
      for (int j = 0; j < PUZZLE_DIMENSION; j++) {
        PuzzleCard k = board[i][j];
        if (k != null) {
          k.setAvailableSides(k.getNumPuzzleCard());
          if (
            canInsertCorner(board2, i, j, k) || canInsertEdge(board2, i, j, k)
              || isPossibleInsertCentre(board2, i, j, k)
          ) {
            board2[i][j] = k;
          }
        }
      }
    }

    board = board2;

  }

  /*
   * Comprueba si es posible colocar la ficha en una de las esquinas del tablero. Para que devuelva true la ficha debe
   * contener la subcadena “00”, las posiciones i-j deben ser esquina, y la ficha encaja con las fichas con las que
   * linda que ya están colocadas en eltablero. En otro caso devolverá falso.
   */
  private static boolean canInsertCorner(PuzzleCard[][] board, int i, int j, PuzzleCard value1) {
    if (value1.getNumPuzzleCard().contains("00")) {
      String piece1;
      String piece2;

      String value = "";
      // rotar ficha y eliminar esquinas
      for (int p = 0; p < value1.getNumPuzzleCard().length(); p++) {
        // roto a partir de un borde trato la ficha como algo circular
        int position = (value1.getNumPuzzleCard().indexOf('0') + p) % value1.getNumPuzzleCard().length();
        if (value1.getNumPuzzleCard().charAt(position) != '0') {
          value += value1.getNumPuzzleCard().charAt(position);
        }
      }

      if (i == 0 && j == 0) {
        value1.setAvailableSides(value);
        return true;
      } else if (i == 0 && j == PUZZLE_DIMENSION - 1) {
        boolean isPossible = false;
        piece1 = board[0][PUZZLE_DIMENSION - 2].getAvailableSides();
        if (board[0][PUZZLE_DIMENSION - 2].getAvailableSides().charAt(0) == value.charAt(value.length() - 1)) {
          isPossible = true;
          board[0][PUZZLE_DIMENSION - 2]
            .setAvailableSides(board[0][PUZZLE_DIMENSION - 2].getAvailableSides().substring(1)); // quito el primer lado
          value = value.substring(0, value.length() - 1); // quito el último lado
        }

        if (isPossible) {
          value1.setAvailableSides(value);
        } else {
          board[0][PUZZLE_DIMENSION - 2].setAvailableSides(piece1);
        }

        return isPossible;
      } else if (i == PUZZLE_DIMENSION - 1 && j == 0) {
        boolean isPossible = false;
        piece1 = board[PUZZLE_DIMENSION - 2][0].getAvailableSides();
        if (board[PUZZLE_DIMENSION - 2][0].getAvailableSides().charAt(0) == value.charAt(0)) {
          // A la ficha de arriba sólo le queda un lado disponible
          isPossible = true;
          board[PUZZLE_DIMENSION - 2][0].setAvailableSides("");// quito el último lado
          value = value.substring(1); // quito el primer lado
        }

        if (isPossible) {
          value1.setAvailableSides(value);
        } else {
          board[PUZZLE_DIMENSION - 2][0].setAvailableSides(piece1);
        }

        return isPossible;
      } else if (i == PUZZLE_DIMENSION - 1 && j == PUZZLE_DIMENSION - 1) {
        boolean isPossible = false;
        piece2 = board[PUZZLE_DIMENSION - 2][PUZZLE_DIMENSION - 1].getAvailableSides();
        if (
          board[PUZZLE_DIMENSION - 2][PUZZLE_DIMENSION - 1].getAvailableSides().charAt(0) == value
            .charAt(value.length() - 1)
        ) {
          isPossible = true;
          board[PUZZLE_DIMENSION - 2][PUZZLE_DIMENSION - 1].setAvailableSides("");// quito el último lado
          value = value.substring(0, value.length() - 1); // quito el ultimo lado
        }

        if (isPossible) {
          piece1 = board[PUZZLE_DIMENSION - 1][PUZZLE_DIMENSION - 2].getAvailableSides();
          isPossible = false;
          if (board[PUZZLE_DIMENSION - 1][PUZZLE_DIMENSION - 2].getAvailableSides().charAt(0) == value.charAt(0)) {
            // en ambas cards me queda un lado disponible
            isPossible = true;
            board[PUZZLE_DIMENSION - 1][PUZZLE_DIMENSION - 2].setAvailableSides("");// quito el último lado
            value = ""; // quito el ultimo lado
          }

          if (isPossible) {
            value1.setAvailableSides(value);
          } else {
            board[PUZZLE_DIMENSION - 1][PUZZLE_DIMENSION - 2].setAvailableSides(piece1);
            board[PUZZLE_DIMENSION - 2][PUZZLE_DIMENSION - 1].setAvailableSides(piece2);
          }

        } else {
          board[PUZZLE_DIMENSION - 2][PUZZLE_DIMENSION - 1].setAvailableSides(piece2);
        }

        return isPossible;
      }

    }

    return false;
  }

  /*
   * Comprueba si es posible colocar la ficha en uno de los bordes del tablero. Para que devuelva true la ficha debe
   * contener el carácter “0”, las posiciones i-j deben ser borde, y la ficha encaja con las fichas con las que linda
   * que ya están colocadas en el tablero. En otro caso devolverá falso.
   */
  private static boolean canInsertEdge(PuzzleCard[][] board, int i, int j, PuzzleCard puzzleCard) {
    if (puzzleCard.getNumPuzzleCard().contains("0") && !puzzleCard.getNumPuzzleCard().contains("00")) {
      String piece1;
      String piece2;

      boolean isPossible = false;
      String value = "";
      // rotar ficha y eliminar borde
      for (int p = 0; p < puzzleCard.getNumPuzzleCard().length(); p++) {
        int position = (puzzleCard.getNumPuzzleCard().indexOf('0') + p) % puzzleCard.getNumPuzzleCard().length();
        if (puzzleCard.getNumPuzzleCard().charAt(position) != '0') {
          value += puzzleCard.getNumPuzzleCard().charAt(position);
        }
      }

      if (i == 0 && j > 0 && j < PUZZLE_DIMENSION - 1) { // borde de arriba
        piece1 = board[0][j - 1].getAvailableSides();
        if (board[0][j - 1].getAvailableSides().charAt(0) == value.charAt(value.length() - 1)) {
          isPossible = true;
          board[0][j - 1].setAvailableSides(board[0][j - 1].getAvailableSides().substring(1));// quito el primer lado
          value = value.substring(0, value.length() - 1); // quito el ultimo lado
        }
        if (isPossible) {
          puzzleCard.setAvailableSides(value);
        } else {
          board[0][j - 1].setAvailableSides(piece1);
        }

        return isPossible;
      } else if (i == PUZZLE_DIMENSION - 1 && j > 0 && j < PUZZLE_DIMENSION - 1) { // borde de abajo
        piece2 = board[PUZZLE_DIMENSION - 2][j].getAvailableSides();
        if (board[PUZZLE_DIMENSION - 2][j].getAvailableSides().charAt(0) == value.charAt(1)) {
          isPossible = true;
          board[PUZZLE_DIMENSION - 2][j].setAvailableSides("");// quito el primer lado
          value = value.charAt(0) + value.substring(2); // quito el lado del medio
        }

        if (isPossible) {
          isPossible = false;
          piece1 = board[PUZZLE_DIMENSION - 1][j - 1].getAvailableSides();
          if (board[PUZZLE_DIMENSION - 1][j - 1].getAvailableSides().charAt(0) == value.charAt(0)) {
            // En la ficha anterior sólo le queda un lado
            
            isPossible = true;
            board[PUZZLE_DIMENSION - 1][j - 1].setAvailableSides("");// quito el lado
            value = value.substring(1); // quito el primer lado
          }

          if (isPossible) {
            puzzleCard.setAvailableSides(value);
          } else {
            board[PUZZLE_DIMENSION - 1][j - 1].setAvailableSides(piece1);
            board[PUZZLE_DIMENSION - 2][j].setAvailableSides(piece2);
          }

        } else {
          board[PUZZLE_DIMENSION - 2][j].setAvailableSides(piece2);
        }

        return isPossible;

      } else if (i > 0 && i < PUZZLE_DIMENSION - 1 && j == 0) { // borde izquierda
        piece1 = board[i - 1][j].getAvailableSides();
        if (board[i - 1][j].getAvailableSides().charAt(0) == value.charAt(0)) {
          isPossible = true;
          board[i - 1][j].setAvailableSides("");// quito el primer lado
          value = value.substring(1); // quito el primer lado
        }

        if (isPossible) {
          puzzleCard.setAvailableSides(value);
        } else {
          board[i - 1][j].setAvailableSides(piece1);
        }

        return isPossible;
      } else if (i > 0 && i < PUZZLE_DIMENSION - 1 && j == PUZZLE_DIMENSION - 1) { // borde derecha
        piece1 = board[i - 1][j].getAvailableSides();
        if (board[i - 1][j].getAvailableSides().charAt(0) == value.charAt(value.length() - 1)) {
          isPossible = true;
          board[i - 1][j].setAvailableSides("");// quito el primer lado
          value = value.substring(0, value.length() - 1); // quito el ultimo lado
        }

        if (isPossible) {
          piece2 = board[i][j - 1].getAvailableSides();
          isPossible = false;
          if (board[i][j - 1].getAvailableSides().charAt(0) == value.charAt(value.length() - 1)) {
            isPossible = true;
            board[i][j - 1].setAvailableSides(board[i][j - 1].getAvailableSides().substring(1));// quito el primer lado
            value = value.substring(0, value.length() - 1); // quito el ultimo lado
          }

          if (isPossible) {
            puzzleCard.setAvailableSides(value);
          } else {
            board[i - 1][j].setAvailableSides(piece1);
            board[i][j - 1].setAvailableSides(piece2);
          }

        } else {
          board[i - 1][j].setAvailableSides(piece1);
        }

        return isPossible;
      }
    }
    return false;
  }

  /*
   * Comprueba si es posible colocar la ficha en el centro del tablero. Para que devuelva true la ficha no puede
   * contener un carácter “0”, las posiciones i-j deben ser centro, y la ficha encaja con las fichas con las que linda
   * que ya están colocadas en el tablero. En otro caso devolverá falso.
   */
  private static boolean isPossibleInsertCentre(PuzzleCard[][] board, int i, int j, PuzzleCard puzzleCard) {
    if (!puzzleCard.getNumPuzzleCard().contains("0")) {
      String value = puzzleCard.getNumPuzzleCard();
      if (i != 0 && j != 0 && i != PUZZLE_DIMENSION - 1 && j != PUZZLE_DIMENSION - 1) {
        String piece1;
        String piece2;
        boolean isPossible = false;
        piece1 = board[i - 1][j].getAvailableSides();

        for (int p = 0; p < value.length() && !isPossible; p++) {
          if (board[i - 1][j].getAvailableSides().charAt(0) == value.charAt(p)) {
            isPossible = true;
            board[i - 1][j].setAvailableSides("");
            // girar la ficha correctamente y eliminar usada
            String aux = "";
            for (int x = 0; x < value.length(); x++) {
              int pos = (p + x) % value.length();
              if (pos != p) {
                aux += value.charAt(pos);
              }
            }
            value = aux;
          }
        }

        if (isPossible) {
          piece2 = board[i][j - 1].getAvailableSides();
          isPossible = false;
          if (board[i][j - 1].getAvailableSides().charAt(0) == value.charAt(value.length() - 1)) {
            isPossible = true;
            board[i][j - 1].setAvailableSides(board[i][j - 1].getAvailableSides().substring(1));// quito el primer lado
            value = value.substring(0, value.length() - 1); // quito el ultimo lado
          }

          if (isPossible) {
            puzzleCard.setAvailableSides(value);
          } else {
            board[i - 1][j].setAvailableSides(piece1);
            board[i][j - 1].setAvailableSides(piece2);
          }
        } else {
          board[i - 1][j].setAvailableSides(piece1);
        }

        return isPossible;
      }
    }
    
    return false;
  }

  // Exercise 8
  public static boolean exitMaze(char[][] maze, int positionX, int positionY) {
    return false;
  }

}
