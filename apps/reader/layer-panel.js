// Layers of the open note: the Layers panel (show, hide, lock, rename, reorder by dragging,
// opacity, add and remove), which layer edits go to (ensureEditableLayer picks an unlocked,
// visible one), and the ink not yet written at the audio's playing time, dimmed (syncInk).
// app.js wires it in with layerPanelController(); `app.activeLayer` is the layer in use.
import { indexTimedInk, updateTimedInk } from "./ink-timeline.js";
import { icon } from "./icons.js";

export function layerPanelController({ $, action, audio, resize, status, app }) {
  // Dims ink not yet written at the playing time. Only pages on screen are touched (others catch up
  // when they come into view), and nothing at all while sync is off and the ink is already whole.
  let inkSyncedOff = false;
  function syncInk() {
    const recording = audio.recording,
      time = audio.time;
    if (!recording && inkSyncedOff) return;
    inkSyncedOff = !recording;
    const addedTimings = recording?.timings;
    for (const p of app.panels) {
      if (!p.view || (recording && p.near === false)) continue;
      if (addedTimings && recording) {
        const key = `${recording.id}:${p.inkRevision ?? 0}`;
        if (p.addedInkKey !== key) {
          p.addedInkKey = key;
          p.addedInk = indexTimedInk(p.el, addedTimings);
        }
        updateTimedInk(p.addedInk || [], recording.id, time);
      } else {
        updateTimedInk(p.ink || [], recording?.id, time);
      }
    }
  }
  function syncActiveLayerHighlight() {
    for (const el of $("layersList").querySelectorAll(".layer")) {
      const active = Number(el.dataset.layerId) === app.activeLayer;
      el.classList.toggle("active", active);
      el.setAttribute("aria-selected", String(active));
    }
    const current = app.doc?.layers?.find((l) => l.id === app.activeLayer);
    if ($("layersToggle")) {
      if (current?.locked) $("layersToggle").dataset.locked = "true";
      else delete $("layersToggle").dataset.locked;
    }
  }
  function ensureEditableLayer() {
    if (!app.doc?.layers?.length) return null;
    let layer = app.doc.layers.find((l) => l.id === app.activeLayer);
    if (layer?.visible && !layer.locked) return layer;
    const fallback = app.doc.layers.findLast((l) => l.visible && !l.locked);
    if (fallback) {
      app.activeLayer = fallback.id;
      syncActiveLayerHighlight();
      return fallback;
    }
    status(
      layer?.locked
        ? "Layer is locked. Click the padlock icon in Layers (Shift+L) to unlock it."
        : "Layer is hidden. Click the eye icon in Layers (Shift+L) to show it.",
      true,
    );
    return null;
  }
  function layerPanel(layers) {
    const current = layers.find((l) => l.id === app.activeLayer);
    if (!current || !current.visible || current.locked) {
      const unlocked = layers.findLast((l) => l.visible && !l.locked);
      if (unlocked) app.activeLayer = unlocked.id;
      else if (!current) app.activeLayer = layers[0]?.id || 0;
    }
    $("layersList").replaceChildren();
    const moveLayer = (fromIndex, toIndex) => {
      if (toIndex < 0 || toIndex >= layers.length || fromIndex === toIndex) return;
      const order = layers.map((l) => l.id);
      const [moved] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, moved);
      action("reorderLayers", { order });
    };
    layers.forEach((layer, index) => {
      const row = document.createElement("div");
      row.className =
        "layer" +
        (layer.id === app.activeLayer ? " active" : "") +
        (layer.locked ? " locked" : "") +
        (!layer.visible ? " hidden-layer" : "");
      row.dataset.layerId = String(layer.id);
      row.tabIndex = 0;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(layer.id === app.activeLayer));
      row.setAttribute("aria-label", `Select ${layer.name}`);
      const chooseThisLayer = () => {
        if (app.activeLayer === layer.id) return;
        app.activeLayer = layer.id;
        syncActiveLayerHighlight();
      };
      row.onclick = (e) => {
        if (e.target.closest("button, input[type='range']")) return;
        chooseThisLayer();
      };
      row.onkeydown = (e) => {
        if (e.target !== row) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          chooseThisLayer();
        } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          moveLayer(index, index + (e.key === "ArrowUp" ? -1 : 1));
        }
      };
      const controls = document.createElement("div");
      controls.className = "layer-controls";
      const grip = document.createElement("span");
      grip.className = "layer-grip";
      grip.title = "Drag to reorder layer";
      grip.append(icon("grip"));
      const name = document.createElement("input");
      name.className = "layer-title";
      name.value = layer.name;
      name.setAttribute("aria-label", `Layer name ${layer.id + 1}`);
      name.onfocus = chooseThisLayer;
      name.onchange = () =>
        action("layer", { layer: { ...layer, name: name.value } });
      const actions = document.createElement("div");
      actions.className = "layer-actions";
      const up = document.createElement("button");
      up.type = "button";
      up.className = "icon-button layer-move";
      up.disabled = index === 0;
      up.title = "Move layer up";
      up.setAttribute("aria-label", `Move ${layer.name} up`);
      up.append(icon("arrowUp"));
      up.onclick = (e) => {
        e.stopPropagation();
        moveLayer(index, index - 1);
      };
      const down = document.createElement("button");
      down.type = "button";
      down.className = "icon-button layer-move";
      down.disabled = index === layers.length - 1;
      down.title = "Move layer down";
      down.setAttribute("aria-label", `Move ${layer.name} down`);
      down.append(icon("arrowDown"));
      down.onclick = (e) => {
        e.stopPropagation();
        moveLayer(index, index + 1);
      };
      const visible = document.createElement("button");
      visible.type = "button";
      visible.className = "icon-button layer-visible";
      visible.setAttribute("aria-label", layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`);
      visible.setAttribute("aria-pressed", String(layer.visible));
      visible.title = layer.visible ? "Visible (click to hide)" : "Hidden (click to show)";
      visible.append(icon(layer.visible ? "eye" : "eyeOff"));
      visible.onclick = (e) => {
        e.stopPropagation();
        action("layer", { layer: { ...layer, visible: !layer.visible } });
      };
      const lock = document.createElement("button");
      lock.type = "button";
      lock.className = "icon-button layer-lock";
      lock.setAttribute("aria-label", `${layer.locked ? "Unlock" : "Lock"} ${layer.name}`);
      lock.setAttribute("aria-pressed", String(layer.locked));
      lock.title = layer.locked ? "Locked (click to unlock)" : "Unlocked (click to lock)";
      lock.append(icon(layer.locked ? "lock" : "unlock"));
      lock.onclick = (e) => {
        e.stopPropagation();
        action("layer", { layer: { ...layer, locked: !layer.locked } });
      };
      actions.append(up, down, visible, lock);
      controls.append(grip, name, actions);
      const meta = document.createElement("div");
      meta.className = "layer-opacity-row";
      if (layer.locked) {
        const badge = document.createElement("span");
        badge.className = "layer-badge locked";
        badge.textContent = "Locked";
        meta.append(badge);
      } else if (!layer.visible) {
        const badge = document.createElement("span");
        badge.className = "layer-badge muted";
        badge.textContent = "Hidden";
        meta.append(badge);
      }
      const opacity = document.createElement("input");
      opacity.type = "range";
      opacity.min = 0;
      opacity.max = 1;
      opacity.step = 0.05;
      opacity.value = layer.opacity;
      opacity.setAttribute("aria-label", `Opacity ${layer.name}`);
      const pct = document.createElement("output");
      pct.className = "layer-opacity-value";
      pct.textContent = `${Math.round(layer.opacity * 100)}%`;
      opacity.oninput = () => {
        pct.textContent = `${Math.round(Number(opacity.value) * 100)}%`;
      };
      opacity.onchange = () =>
        action("layer", { layer: { ...layer, opacity: Number(opacity.value) } });
      meta.append(opacity, pct);
      row.append(controls, meta);
      $("layersList").append(row);
    });
    syncActiveLayerHighlight();
  }
  // Drag a layer card vertically to reorder layers.
  $("layersList").addEventListener("pointerdown", (down) => {
    const item = down.target.closest(".layer");
    if (!item || down.button !== 0 || down.target.closest("button, input")) return;
    const container = $("layersList");
    const startY = down.clientY, pointer = down.pointerId;
    let dragging = false, grab = 0;
    const siblings = () => [...container.querySelectorAll(".layer")];
    const initialOrder = siblings().map((el) => Number(el.dataset.layerId));
    const move = (event) => {
      if (event.pointerId !== pointer) return;
      if (!dragging) {
        if (Math.abs(event.clientY - startY) < 6) return;
        dragging = true;
        grab = startY - item.getBoundingClientRect().top;
        item.classList.add("dragging");
        try { item.setPointerCapture(pointer); } catch { /* Released already. */ }
      }
      item.style.transform = "";
      const others = siblings().filter((el) => el !== item);
      const top = event.clientY - grab, centre = top + item.offsetHeight / 2;
      const index = others.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 < centre;
      }).length;
      const ref = others[index];
      if (ref ? item.nextElementSibling !== ref : others.at(-1)?.nextElementSibling !== item) {
        if (ref) container.insertBefore(item, ref);
        else others.at(-1)?.after(item);
      }
      item.style.transform = `translateY(${top - item.getBoundingClientRect().top}px)`;
    };
    const finish = (event) => {
      if (event.pointerId !== pointer) return;
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", finish);
      removeEventListener("pointercancel", finish);
      item.classList.remove("dragging");
      item.style.transform = "";
      if (!dragging) return;
      const nextOrder = siblings().map((el) => Number(el.dataset.layerId));
      if (nextOrder.some((id, i) => id !== initialOrder[i])) {
        action("reorderLayers", { order: nextOrder });
      }
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", finish);
    addEventListener("pointercancel", finish);
  });
  $("closeLayers").onclick = () => {
    $("layersPanel").hidden = true;
    $("layersToggle").setAttribute("aria-expanded", "false");
    $("layersToggle").focus();
    resize();
  };
  $("layersToggle").onclick = () => {
    $("layersPanel").hidden = !$("layersPanel").hidden;
    $("layersToggle").setAttribute(
      "aria-expanded",
      String(!$("layersPanel").hidden),
    );
    resize();
  };
  $("addLayer").onclick = () => {
    const id = Math.max(...app.doc.layers.map((l) => l.id), -1) + 1;
    app.activeLayer = id;
    action("layer", {
      layer: {
        id,
        name: `Layer ${id + 1}`,
        visible: true,
        locked: false,
        opacity: 1,
      },
    });
  };
  return { ensureEditableLayer, layerPanel, syncInk };
}
