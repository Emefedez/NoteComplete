export function readerURL(explicit, hostUri, port = 8768) {
 if (explicit) {
  const url = new URL(explicit);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Reader URL must use HTTP or HTTPS.');
  return url.href;
 }
 if (!hostUri) throw Error('Computer not found. Run npm start and scan its QR code.');
 const host = new URL(`http://${hostUri}`).hostname;
 return `http://${host}:${port}/`;
}
function sanitizeFileName(name, fallback = 'Note.nfedit') {
 return String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || fallback;
}

export function exportRequest(data, origin, reader) {
 if (new URL(origin).origin !== new URL(reader).origin) throw Error('Unexpected reader origin.');
 const message = JSON.parse(data);
 if (message.type !== 'noteful-export' || !Number.isSafeInteger(message.id) || typeof message.base64 !== 'string' || typeof message.name !== 'string') throw Error('Invalid export request.');
 return {...message, name: sanitizeFileName(message.name, 'Note.nfedit')};
}

export function shareRequest(data, origin, reader) {
 if (new URL(origin).origin !== new URL(reader).origin) throw Error('Unexpected reader origin.');
 const message = typeof data === 'string' ? JSON.parse(data) : data;
 if (!Number.isSafeInteger(message?.id)) throw Error('Invalid share request.');
 if (message.type === 'notecomplete-share-file') {
  if (typeof message.base64 !== 'string' || typeof message.name !== 'string') throw Error('Invalid share file payload.');
  const mime = typeof message.mime === 'string' && message.mime.trim() ? message.mime.trim() : 'application/octet-stream';
  return {...message, name: sanitizeFileName(message.name, 'Note.nfedit'), mime};
 }
 if (message.type === 'notecomplete-share-links' || message.type === 'notecomplete-unshare') {
  if (typeof message.shareId !== 'string' || !message.shareId.trim()) throw Error('Invalid share identifier.');
  return {...message, shareId: message.shareId.trim()};
 }
 if (message.type === 'notecomplete-share-address') {
  if (typeof message.address !== 'string' || !message.address.trim()) throw Error('Invalid share address.');
  return {...message, address: message.address.trim()};
 }
 throw Error('Unsupported share request.');
}

export function allowsNavigation(url, reader) {
 try { return url === 'about:blank' || new URL(url).origin === new URL(reader).origin; }
 catch { return false; }
}
