import { openPdf } from "./pdf-background.js";
import { TEXT_EXTENSIONS, hasExtension, looksLikeText, decodeText, isOfficeName, isTableName, isImageName } from "./text-types.js";
import { onlyEuroOffice, needsOfficeMessage } from "./open-with.js";
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
  // HEIC/HEIF photos (an iPhone's camera), decoded by libheif (heic.js) on import.
  if (pictureFormat(bytes) === "heic") return "image";
  // Goodnotes and Notability notebooks (zip archives) and Rnote notes (gzip JSON), imported as Noteful notes.
  if (/\.(goodnotes|ntb|rnote)$/i.test(name)) return "notebook";
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
  // .ppsx, .xltx, .djvu, .vsdx…: only the Office suite module opens them (it is not installed,
  // or the file would have gone to it before this).
  if (onlyEuroOffice(name)) throw Error(needsOfficeMessage(name));
  throw Error(
    "Choose a Noteful note, NoteComplete project, Goodnotes, Notability or Rnote notebook, PDF, HTML page, text or Markdown file, Office document (Word, OpenDocument, Excel, PowerPoint, RTF), EPUB, Jupyter notebook, image, audio or video file.",
  );
}

const HEIF_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/;
// What a picture's first bytes say it is, for the formats kept or decoded specially:
// "gif", "webp", "apng" (an animated PNG: acTL before the first IDAT), "heic", or null.
export function pictureFormat(bytes) {
  const latin = (from, to) => new TextDecoder("latin1").decode(bytes.subarray(from, to));
  const magic = latin(0, 6);
  if (magic === "GIF87a" || magic === "GIF89a") return "gif";
  if (bytes.length >= 12 && latin(0, 4) === "RIFF" && latin(8, 12) === "WEBP") return "webp";
  if (bytes.length >= 12 && latin(4, 8) === "ftyp" && HEIF_BRANDS.test(latin(8, 12))) return "heic";
  if (bytes[0] === 0x89 && latin(1, 4) === "PNG") {
    // Chunks after the 8-byte signature: length (4, big-endian), type (4), data, CRC (4).
    for (let at = 8; at + 8 <= bytes.length;) {
      const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
      const type = latin(at + 4, at + 8);
      if (type === "acTL") return "apng";
      if (type === "IDAT") break;
      at += 12 + length;
    }
  }
  return null;
}
// Animated pictures are kept as they came (the core stores GIF, WebP and PNG bytes as they are),
// so they still move on the page; a still copy would lose every frame after the first.
const KEPT = { gif: "image/gif", webp: "image/webp", apng: "image/png" };

function base64Of(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error || Error("Could not read this image."));
    reader.readAsDataURL(blob);
  });
}

// `any`: whatever image the browser decodes (a pasted BMP or SVG too); it is kept as PNG. GIF,
// WebP and animated PNG keep their own bytes, and HEIC/HEIF photos become JPEG.
export async function readImage(file, { any = false } = {}) {
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  if (any ? !/^image\//.test(file.type || "") && !pictureFormat(head) : fileKind(file.name, head) !== "image") {
    throw Error(any ? "The clipboard does not hold an image this browser can read." : "Choose a PNG, JPEG, GIF, WebP, HEIC, AVIF, BMP or ICO image.");
  }
  const format = pictureFormat(head);
  if (format === "heic") {
    const { heicBlob } = await import("./heic.js");
    const jpeg = await heicBlob(new Uint8Array(await file.arrayBuffer()));
    const bitmap = await createImageBitmap(jpeg);
    try {
      return { base64: await base64Of(jpeg), mime: "image/jpeg", size: [bitmap.width, bitmap.height] };
    } finally {
      bitmap.close();
    }
  }
  if (KEPT[format]) {
    const bitmap = await createImageBitmap(file);
    try {
      return { base64: await base64Of(file), mime: KEPT[format], size: [bitmap.width, bitmap.height] };
    } finally {
      bitmap.close();
    }
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
