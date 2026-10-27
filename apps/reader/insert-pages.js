// Page sizes for Pages → Insert. Noteful page units are PDF points × 11/6
// (A4 = 1091.34 × 1543.46), so presets are defined in millimetres.
export const UNITS_PER_POINT = 11 / 6;
const MM_PER_POINT = 25.4 / 72;
export const mmToUnits = mm => (mm / MM_PER_POINT) * UNITS_PER_POINT;
export const unitsToMm = units => (units / UNITS_PER_POINT) * MM_PER_POINT;

export const PRESETS = {
  current: { label: 'Same as current page' },
  a4: { label: 'A4 portrait', mm: [210, 297] },
  a4l: { label: 'A4 landscape', mm: [297, 210] },
  letter: { label: 'US Letter portrait', mm: [215.9, 279.4] },
  slide43: { label: 'Slide 4:3', mm: [254, 190.5] },
  slide169: { label: 'Slide 16:9', mm: [338.67, 190.5] },
  custom: { label: 'Custom size' },
};
// Extra writing space beside or below the content, as in widened Noteful pages.
export const SPACE = {
  none: { label: 'None', grow: [1, 1] },
  right50: { label: 'Right, half width', grow: [1.5, 1] },
  right100: { label: 'Right, full width', grow: [2, 1] },
  below50: { label: 'Below, half height', grow: [1, 1.5] },
};

export function blankSize(preset, current, custom) {
  if (preset === 'current') return [...current];
  if (preset === 'custom') return custom.map(mmToUnits);
  return PRESETS[preset].mm.map(mmToUnits);
}

// One NewPage per PDF page: the PDF keeps its scale in `rect`, extra space grows the page.
export function pdfPages(resource, sizesInPoints, from, to, space, unitsPerPoint = UNITS_PER_POINT) {
  const [gx, gy] = SPACE[space].grow;
  const pages = [];
  for (let i = from; i <= to; i++) {
    const [w, h] = sizesInPoints[i].map(v => v * unitsPerPoint);
    pages.push({
      size: [w * gx, h * gy],
      pdf: { resource, page_index: i, ...(gx !== 1 || gy !== 1 ? { rect: [0, 0, w, h] } : {}) },
    });
  }
  return pages;
}

// Insert position from the dialog choice, as a display index.
export function insertAt(where, current, count) {
  return where === 'before' ? current : where === 'end' ? count : current + 1;
}
