// Java subset: classes written in Java itself and loaded before the user's code (quietly: they
// record no steps). The exception hierarchy, so that user exceptions can extend them and
// catch clauses match by superclass.

const HIERARCHY = [
  // [name, superclass, package]
  ['Exception', 'Throwable', 'java.lang'],
  ['Error', 'Throwable', 'java.lang'],
  ['RuntimeException', 'Exception', 'java.lang'],
  ['StackOverflowError', 'Error', 'java.lang'],
  ['OutOfMemoryError', 'Error', 'java.lang'],
  ['AssertionError', 'Error', 'java.lang'],
  ['NoSuchMethodError', 'Error', 'java.lang'],
  ['NullPointerException', 'RuntimeException', 'java.lang'],
  ['ArithmeticException', 'RuntimeException', 'java.lang'],
  ['IndexOutOfBoundsException', 'RuntimeException', 'java.lang'],
  ['ArrayIndexOutOfBoundsException', 'IndexOutOfBoundsException', 'java.lang'],
  ['StringIndexOutOfBoundsException', 'IndexOutOfBoundsException', 'java.lang'],
  ['IllegalArgumentException', 'RuntimeException', 'java.lang'],
  ['NumberFormatException', 'IllegalArgumentException', 'java.lang'],
  ['IllegalStateException', 'RuntimeException', 'java.lang'],
  ['ClassCastException', 'RuntimeException', 'java.lang'],
  ['NegativeArraySizeException', 'RuntimeException', 'java.lang'],
  ['ArrayStoreException', 'RuntimeException', 'java.lang'],
  ['UnsupportedOperationException', 'RuntimeException', 'java.lang'],
  ['CloneNotSupportedException', 'Exception', 'java.lang'],
  ['InterruptedException', 'Exception', 'java.lang'],
  ['NoSuchElementException', 'RuntimeException', 'java.util'],
  ['InputMismatchException', 'NoSuchElementException', 'java.util'],
  ['ConcurrentModificationException', 'RuntimeException', 'java.util'],
  ['EmptyStackException', 'RuntimeException', 'java.util'],
  ['IllegalFormatException', 'IllegalArgumentException', 'java.util'],
  ['IllegalFormatConversionException', 'IllegalFormatException', 'java.util'],
  ['UnknownFormatConversionException', 'IllegalFormatException', 'java.util'],
  ['IOException', 'Exception', 'java.io'],
  ['EmptyException', 'RuntimeException', 'es.uvigo.esei.aed1.tads.common'],
  ['EmptyTreeException', 'RuntimeException', 'es.uvigo.esei.aed2.tree.exceptions'],
  ['HeapEmptyException', 'RuntimeException', 'es.uvigo.esei.aed2.heap.exception'],
];

const THROWABLE = `
public class Throwable {
  private String message;
  private Throwable cause;
  public Throwable() {}
  public Throwable(String message) { this.message = message; }
  public Throwable(String message, Throwable cause) { this.message = message; this.cause = cause; }
  public Throwable(Throwable cause) { this.cause = cause; this.message = cause == null ? null : cause.toString(); }
  protected Throwable(String message, Throwable cause, boolean a, boolean b) { this.message = message; this.cause = cause; }
  public String getMessage() { return message; }
  public String getLocalizedMessage() { return message; }
  public Throwable getCause() { return cause; }
  public Throwable initCause(Throwable c) { this.cause = c; return this; }
  public String toString() { String n = getClass().getName(); return message != null ? n + ": " + message : n; }
  public void printStackTrace() { System.err.println(this); }
}
`;

export const PRELUDE_PACKAGES = { Throwable: 'java.lang' };

export function preludeSource() {
  let src = THROWABLE;
  for (const [name, sup, pkg] of HIERARCHY) {
    PRELUDE_PACKAGES[name] = pkg;
    src += `
public class ${name} extends ${sup} {
  public ${name}() { super(); }
  public ${name}(String message) { super(message); }
  public ${name}(String message, Throwable cause) { super(message, cause); }
  public ${name}(Throwable cause) { super(cause); }
  public ${name}(String message, Throwable cause, boolean a, boolean b) { super(message, cause); }
}`;
  }
  return src;
}
