// A drawn line without the whole page. The engine answers a `draw` with the new item alone
// (worker.js; `Editor::drawn` in the core): its element as the page's SVG has it, where it
// goes, and the few fields of the page view that change. Here that answer is put into the
// view the reader holds, and into the page on screen.
//
// Both refuse (null, false) whatever they are not sure of, and the reader then asks the
// engine for the view, or draws the page again from it, as it did for every stroke before.

const CLOSING = "</svg>", GROUP_END = "</g>";

// Where the item goes in the view's SVG text; -1 when the place cannot be found.
function placeInText(view, drawn) {
  const svg = view.svg;
  if (typeof svg !== "string" || !svg.endsWith(CLOSING)) return -1;
  const closing = svg.length - CLOSING.length;
  // A group ends where the next one starts, or where the page does.
  const endOf = (start, next) => {
    for (const opening of next) {
      const at = svg.indexOf(opening, start + 1);
      if (at >= 0) return at;
    }
    return closing;
  };
  let end;
  if (drawn.tape) {
    // The stripes are defined once per page, with its first tape: a page without them,
    // or a layer with no tape yet (its group is not there), needs the whole view.
    if (!svg.includes("nc-tape-pattern")) return -1;
    const start = svg.indexOf(`<g data-tapes="${drawn.layer}" `);
    if (start < 0) return -1;
    end = endOf(start, ['<g data-tapes="']);
  } else {
    // The usual stroke, on the top layer of a page without tape: its layer's group is
    // the last thing on the page, and nothing has to be searched.
    const visible = (view.layers || []).filter((l) => l.visible);
    if (!drawn.under && !view.tapes?.length && visible.at(-1)?.id === drawn.layer) end = closing;
    else {
      const start = svg.indexOf(`<g data-layer="${drawn.layer}" `);
      if (start < 0) return -1;
      end = endOf(start, ['<g data-layer="', '<g data-tapes="']);
      // Under the ink: before the layer's first item that is not under it.
      if (drawn.before != null) {
        const at = svg.indexOf(`<g data-item="${drawn.before}">`, start);
        return at >= 0 && at < end ? at : -1;
      }
    }
  }
  // Last in its group.
  const at = end - GROUP_END.length;
  return at > 0 && svg.startsWith(GROUP_END, at) ? at : -1;
}

// The page view after the line `drawn`, given the view from just before it; null when
// `view` is not that view (another page, another state of the note) or the item's place
// is not found. `view` is left as it was.
export function applyDrawPatch(view, drawn) {
  if (!view || !drawn || typeof drawn.item !== "string" || !drawn.item.startsWith(`<g data-item="${drawn.id}"`)) return null;
  if (!Number.isFinite(drawn.base_state) || view.engine_state !== drawn.base_state) return null;
  if (view.slot !== drawn.slot || view.page !== drawn.page || !Number.isInteger(view.visible_added)) return null;
  const at = placeInText(view, drawn);
  if (at < 0) return null;
  const next = {
    ...view,
    svg: view.svg.slice(0, at) + drawn.item + view.svg.slice(at),
    visible_added: view.visible_added + 1,
    edit_count: drawn.edit_count,
    can_undo: drawn.can_undo,
    can_redo: drawn.can_redo,
    engine_state: drawn.engine_state,
  };
  if (drawn.shape) next.shapes = [...(view.shapes || []), drawn.shape];
  if (drawn.tape_entry) next.tapes = [...(view.tapes || []), drawn.tape_entry];
  if (drawn.part) {
    // Lines' parts come before those of pictures and text boxes.
    const parts = [...(view.parts || [])], images = parts.findIndex((p) => String(p.item).startsWith("image:"));
    parts.splice(images < 0 ? parts.length : images, 0, drawn.part);
    next.parts = parts;
  }
  return next;
}

// Puts the line's element (`item`, parsed by the caller) into the page's <svg> where the
// view's text has it. False, with nothing changed, when its place is not there.
export function placeDrawnItem(svg, drawn, item) {
  if (!svg || !item || item.getAttribute("data-item") !== drawn.id) return false;
  const children = (el) => Array.from(el.children || []);
  const group = children(svg).find((el) => el.getAttribute(drawn.tape ? "data-tapes" : "data-layer") === String(drawn.layer));
  if (!group) return false;
  if (drawn.tape) {
    const striped = children(svg).some((el) => el.localName === "defs" && children(el).some((c) => c.localName === "pattern" && String(c.id).startsWith("ncTape")));
    if (!striped) return false;
  }
  if (drawn.before != null) {
    const next = children(group).find((el) => el.getAttribute("data-item") === drawn.before);
    if (!next) return false;
    group.insertBefore(item, next);
  } else group.append(item);
  return true;
}
