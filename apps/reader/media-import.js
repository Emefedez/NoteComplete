import { openPdf } from "./pdf-background.js";
import { TEXT_EXTENSIONS, hasExtension, looksLikeText, decodeText, isOfficeName, isTableName, isImageName } from "./text-types.js";
const TEXT_EXT = new RegExp(`\\.(${TEXT_EXTENSIONS.join("|")})$`, "i");

// A v13 .nfedit: a tar whose first member, manifest.json, names the project format. A file may
// be checked from its first bytes only; the manifest begins at byte 512.
export function isProjectArchive(bytes) {
  const text = (from, to) => new TextDecoder().decode(bytes.subarray(from, to));
  return text(257, 262) === "ustar" && text(0, 13) === "manifest.json" && /^\{"format":"notecomplete-project"/.test(text(512, 560));
}

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
  // GIF, BMP, ICO and AVIF raster images (decoded to PNG via canvas/createImageBitmap).
  const magic6 = new TextDecoder("latin1").decode(bytes.subarray(0, 6));
  if (magic6 === "GIF87a" || magic6 === "GIF89a") return "image";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d && isImageName(name)) return "image";
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00 && /\.ico$/i.test(name)) return "image";
  if (bytes.length >= 12 && new TextDecoder("latin1").decode(bytes.subarray(4, 12)).startsWith("ftypavi")) return "image";
  // Goodnotes and Notability notebooks (zip archives), imported as Noteful notes.
  if (/\.(goodnotes|ntb)$/i.test(name)) return "notebook";
  // .notecomplete: a tar (ustar magic at 257) with the note and its notes.
  if (/\.html?$/i.test(name)) return "html";
  if (isOfficeName(name)) return "office";
  if (TEXT_EXT.test(name)) return "text";
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().toLowerCase();
  if (!/\.[a-z0-9]+$/i.test(name) && (head.startsWith("<!doctype html") || head.startsWith("<html")))
    return "html";
  if (/\.ncstudy$/i.test(name)) return "study-pack";
  const headText = new TextDecoder().decode(bytes.subarray(0, 128)).trimStart();
  if (!/\.nfedit$/i.test(name) && /^\{\s*"format"\s*:\s*"notecomplete-study"/.test(headText))
    return "study-pack";
  if (/\.json$/i.test(name)) return "json";
  // A v13 .nfedit is a tar too (manifest first, format "notecomplete-project").
  if (/\.nfedit$/i.test(name) || isProjectArchive(bytes)) return "project";
  if (/\.(notecomp(lete)?|notepart|tar)$/i.test(name) || new TextDecoder().decode(bytes.subarray(257, 262)) === "ustar")
    return "notecomplete";
  if (
    /\.nfedit$/i.test(name) ||
    headText.startsWith("{")
  )
    return "project";
  // No extension (data files, README, Makefile…): text when the content is.
  if (!hasExtension(name) && looksLikeText(bytes)) return "text";
  // A zip without a name that says what it is: maybe a notebook (the engine checks).
  if (!hasExtension(name) && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return "notebook";
  throw Error(
    "Choose a Noteful note, NoteComplete project, Goodnotes or Notability notebook, PDF, HTML page, text or Markdown file, Office document (Word, OpenDocument, Excel, PowerPoint, RTF), EPUB, Jupyter notebook, image, audio or video file.",
  );
}

// `any`: whatever image the browser decodes (a pasted GIF, BMP or SVG too); it is kept as PNG.
export async function readImage(file, { any = false } = {}) {
  if (any ? !/^image\//.test(file.type || "") : fileKind(file.name, new Uint8Array(await file.slice(0, 64).arrayBuffer())) !== "image") {
    throw Error(any ? "The clipboard does not hold an image this browser can read." : "Choose a PNG, JPEG or WebP image.");
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

// Bounds moved so their centre is `at` (page units), kept inside the page.
export function centredAt(bounds, at, pageSize) {
  const [, , w, h] = bounds;
  const x = Math.min(Math.max(0, at[0] - w / 2), Math.max(0, pageSize[0] - w));
  const y = Math.min(Math.max(0, at[1] - h / 2), Math.max(0, pageSize[1] - h));
  return [x, y, w, h];
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
  const title = (hasExtension(file.name) ? file.name.replace(/\.[^.]+$/, "") : file.name) || "Untitled";
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
  // Word, OpenDocument, Excel and CSV/TSV files are shown as Markdown and can be edited as such
  // (converted: Save writes a new .md copy, never over the original). Their pictures come as
  // `images`, files for the folder `imageFolder` that the Markdown links to.
  if (kind === "office" || (kind === "text" && isTableName(file.name))) {
    const { officeDocument } = await import("./office.js");
    const { markdown, images, folder } = await officeDocument(file.name, new Uint8Array(bytes));
    return { kind: "text", title, text: markdown, bytes, markdown: true, converted: true, images, imageFolder: folder };
  }
  if (kind === "html" || kind === "text") {
    const text = kind === "text" ? decodeText(new Uint8Array(bytes)) : new TextDecoder().decode(bytes);
    return { kind, title, text, bytes };
  }
  return { kind, title, bytes };
}
