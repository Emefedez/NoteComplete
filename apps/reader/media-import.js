import { openPdf } from "./pdf-background.js";

export function fileKind(name, bytes) {
  if (
    bytes[0] === 0xaa &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xcc &&
    bytes[3] === 0xde
  )
    return "note";
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return "pdf";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image";
  if (
    new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
  )
    return "image";
  // .notecomplete: a tar (ustar magic at 257) with the note and its notes.
  if (/\.html?$/i.test(name)) return "html";
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().toLowerCase();
  if (!/\.[a-z0-9]+$/i.test(name) && (head.startsWith("<!doctype html") || head.startsWith("<html")))
    return "html";
  if (/\.(notecomp(lete)?|notepart)$/i.test(name) || new TextDecoder().decode(bytes.subarray(257, 262)) === "ustar")
    return "notecomplete";
  if (
    /\.nfedit$/i.test(name) ||
    new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().startsWith("{")
  )
    return "project";
  throw Error(
    "Choose a Noteful note, NoteComplete project, PDF, HTML page, PNG, JPEG or WebP image.",
  );
}

export async function readImage(file) {
  if (fileKind(file.name, new Uint8Array(await file.slice(0, 64).arrayBuffer())) !== "image") {
    throw Error("Choose a PNG, JPEG or WebP image.");
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw Error("Could not decode this image.");
    context.drawImage(bitmap, 0, 0);
    const url = canvas.toDataURL("image/png");
    if (!url.startsWith("data:image/png;base64,"))
      throw Error("This image is too large for this device.");
    return {
      base64: url.split(",")[1],
      mime: "image/png",
      size: [bitmap.width, bitmap.height],
    };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

export function imageBounds(size, pageSize) {
  const scale = Math.min(
    1,
    (pageSize[0] * 0.8) / size[0],
    (pageSize[1] * 0.8) / size[1],
  );
  const width = size[0] * scale,
    height = size[1] * scale;
  return [(pageSize[0] - width) / 2, (pageSize[1] - height) / 2, width, height];
}

export async function prepareDocument(file) {
  const bytes = await file.arrayBuffer();
  const kind = fileKind(file.name, new Uint8Array(bytes));
  const title = file.name.replace(/\.[^.]+$/, "") || "Untitled";
  if (kind === "pdf") {
    // PDF.js transfers its copy to its worker. Keep original bytes for the project.
    const pdf = await openPdf(new Uint8Array(bytes.slice(0)));
    try {
      const sizes = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index),
          viewport = page.getViewport({ scale: 1 });
        sizes.push([viewport.width, viewport.height]);
        page.cleanup();
      }
      return { kind, title, sizes, bytes };
    } finally {
      await pdf.loadingTask.destroy();
    }
  }
  if (kind === "image") {
    const image = await readImage(file),
      scale = Math.min(1, 1200 / Math.max(...image.size));
    const sizes = [image.size.map((v) => v * scale)];
    return {
      kind,
      title,
      sizes,
      bytes: new ArrayBuffer(0),
      image: {
        base64: image.base64,
        mime: image.mime,
        bounds: [0, 0, ...sizes[0]],
        layer: 0,
      },
    };
  }
  if (kind === "html") {
    const text = new TextDecoder().decode(bytes);
    return { kind, title, text, bytes };
  }
  return { kind, title, bytes };
}
