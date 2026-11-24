// View → Pen button… (learns what this pen's side button sends in this browser, with
// pen-button.js profileFrom, plus the opt-in long-press and an off switch) and the pen test
// dialog that logs every pointer, touch and key event the pen produces.
// app.js wires them in with penSetup(); `app.penProfile` is the profile the pen tools use.
import { PROFILE_KEY, describeProfile, penButtonDetector, profileFrom } from "./pen-button.js";

export function penSetup({ $, closeMenus, fields, status, app }) {
  // View → Pen button…: learns what this pen's side button sends in this browser
  // (pen-button.js profileFrom), plus the opt-in long-press and an off switch.
  let penSetupRun = 0, penSetupFound = null;
  function openPenSetup() {
    closeMenus();
    penSetupFound = null;
    $("penSetupResult").textContent = app.penProfile?.v ? describeProfile(app.penProfile) : "";
    $("penSetupLongPress").checked = !!app.penProfile?.longPress;
    $("penSetupOff").checked = !!app.penProfile?.off;
    $("penSetupStart").textContent = "Start";
    $("penSetupDialog").showModal();
  }
  $("penSetupOpen").onclick = openPenSetup;
  $("penSetupClose").onclick = () => { penSetupRun++; $("penSetupDialog").close(); };
  $("penSetupDialog").addEventListener("close", () => { penSetupRun++; });
  $("penSetupStart").onclick = async () => {
    const run = ++penSetupRun, pad = $("penSetupPad"), step = $("penSetupStep");
    const seen = { hover: [], taps: [], keys: [] };
    let phase = "baseline";
    const wait = (ms, until = () => false) => new Promise((done) => {
      const started = Date.now();
      const tick = () => (run !== penSetupRun || until() || Date.now() - started > ms ? done() : setTimeout(tick, 50));
      tick();
    });
    // Hovering means no pointerdown since the last pointerup (Android reports the button as
    // buttons 1 while hovering, the same as a touching tip).
    let touching = false;
    const down = (e) => { if (e.pointerType === "pen") touching = true; };
    const up = (e) => { if (e.pointerType === "pen") touching = false; };
    // Presses as the app will see them: a hover rising edge, or an entry with the button held.
    const probe = penButtonDetector();
    seen.presses = [];
    // What the pen sends, live, so a step that seems to do nothing says why.
    const live = (e, type) => {
      if (phase === "baseline" || phase === "press") $("penSetupResult").textContent = `Pen ${type === "pointerleave" ? "out of range" : touching ? "touching" : "hovering"} · buttons ${e.buttons} · presses seen: ${seen.presses.length}`;
    };
    const feed = (e, type = e.type) => {
      if (e.pointerType !== "pen") return;
      if (probe.pointer({ ...fields(e), type }) === "menu" && phase === "press") seen.presses.push({ buttons: e.buttons });
      live(e, type);
    };
    const move = (e) => {
      if (e.pointerType === "pen" && !touching) seen.hover.push({ phase, buttons: e.buttons, pressure: e.pressure });
      feed(e);
    };
    const over = (e) => { if (!e.relatedTarget || !pad.contains(e.relatedTarget)) feed(e); };
    const out = (e) => { if (!e.relatedTarget || !pad.contains(e.relatedTarget)) feed(e, "pointerleave"); };
    const menu = (e) => { e.preventDefault(); window.getSelection()?.removeAllRanges(); seen.taps.push({ phase, pointerType: e.pointerType || "", button: e.button }); };
    const key = (e) => seen.keys.push({ phase, key: e.key, code: e.code });
    pad.addEventListener("pointermove", move);
    pad.addEventListener("pointerover", over);
    pad.addEventListener("pointerout", out);
    pad.addEventListener("pointerdown", down);
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", up, true);
    pad.addEventListener("contextmenu", menu);
    addEventListener("keydown", key, true);
    try {
      $("penSetupStart").textContent = "Try again";
      $("penSetupResult").textContent = "";
      step.textContent = "1 of 3 · Hold your pen just above the box, without touching it.";
      await wait(2500);
      phase = "press";
      step.textContent = "2 of 3 · Press the side button while hovering, twice. If nothing happens, hold the button, lift the pen away and bring it back over the box.";
      const presses = () => seen.presses.length;
      await wait(6000, () => presses() >= 2);
      await wait(400);
      phase = "tap";
      step.textContent = "3 of 3 · Hold the side button and tap the box once.";
      await wait(6000, () => seen.taps.some((t) => t.phase === "tap"));
      if (run !== penSetupRun) return;
      penSetupFound = profileFrom({ hover: seen.hover, presses: seen.presses, taps: seen.taps.filter((t) => t.phase === "tap"), keys: seen.keys.filter((k) => k.phase !== "baseline") }, navigator.userAgent);
      step.textContent = "Done. Save to use it, or Try again.";
      $("penSetupResult").textContent = describeProfile(penSetupFound);
    } finally {
      pad.removeEventListener("pointermove", move);
      pad.removeEventListener("pointerover", over);
      pad.removeEventListener("pointerout", out);
      pad.removeEventListener("pointerdown", down);
      removeEventListener("pointerup", up, true);
      removeEventListener("pointercancel", up, true);
      pad.removeEventListener("contextmenu", menu);
      removeEventListener("keydown", key, true);
    }
  };
  $("penSetupSave").onclick = () => {
    const profile = { ...(penSetupFound || app.penProfile || { v: 1 }), v: 1, longPress: $("penSetupLongPress").checked, off: $("penSetupOff").checked };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* Kept for this session only. */ }
    app.penProfile = profile;
    $("penSetupDialog").close();
    status(profile.off ? "Pen button off." : "Pen button saved.");
  };
  // Help → Test pen and stylus: what the browser reports for a pen (its type, buttons and
  // pressure), so a pen button that does not open the quick menu can be told apart.
  {
    const pad = $("penTestPad"), log = $("penTestLog"), lines = [];
    const note = (text) => {
      if (lines.at(-1)?.text === text) { lines.at(-1).count++; } else lines.push({ text, count: 1 });
      while (lines.length > 14) lines.shift();
      log.replaceChildren(...lines.map((l) => { const li = document.createElement("li"); li.textContent = l.count > 1 ? `${l.text} ×${l.count}` : l.text; return li; }));
    };
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerover", "pointerout"])
      pad.addEventListener(type, (e) => {
        // Entering and leaving between the box's own children are not the pen coming or going.
        if ((type === "pointerover" || type === "pointerout") && e.relatedTarget && pad.contains(e.relatedTarget)) return;
        e.preventDefault();
        const state = e.pointerType === "pen"
          ? (type === "pointerover" ? "hover enter" : type === "pointerout" ? "hover exit" : type === "pointermove" ? (e.buttons || e.pressure > 0 ? "contact" : "hover") : "")
          : "";
        note(`${type}${state ? ` · ${state}` : ""} · ${e.pointerType} · button ${e.button} · buttons ${e.buttons} · pressure ${e.pressure.toFixed(2)}${e.shiftKey ? " · Shift" : ""}`);
      });
    // One line per stroke on what the drawing gets from this browser: how many samples a
    // second (with the coalesced ones), whether positions come in whole pixels (a staircase in
    // small handwriting) or fractions, repeated positions, and the pressure at the first touch.
    let stroke = null;
    const whole = (v) => Number.isInteger(v);
    pad.addEventListener("pointerdown", (e) => {
      stroke = { id: e.pointerId, t0: e.timeStamp, t1: e.timeStamp, n: 0, moves: 0, whole: 0, same: 0, last: null, down: e.pressure, first: null, coalesced: typeof e.getCoalescedEvents === "function" };
    });
    pad.addEventListener("pointermove", (e) => {
      if (!stroke || stroke.id !== e.pointerId || !(e.buttons || e.pressure > 0)) return;
      stroke.moves++;
      const samples = e.getCoalescedEvents?.() || [];
      for (const s of samples.length ? samples : [e]) {
        stroke.n++;
        stroke.t1 = s.timeStamp;
        if (whole(s.clientX) && whole(s.clientY)) stroke.whole++;
        if (stroke.last && stroke.last[0] === s.clientX && stroke.last[1] === s.clientY) stroke.same++;
        stroke.last = [s.clientX, s.clientY];
        stroke.first ??= s.pressure;
      }
    });
    pad.addEventListener("pointerup", (e) => {
      if (!stroke || stroke.id !== e.pointerId) return;
      const s = stroke, seconds = Math.max(1e-3, (s.t1 - s.t0) / 1000);
      stroke = null;
      if (!s.n) return;
      note(`stroke · ${e.pointerType} · ${s.n} samples in ${s.moves} moves (${Math.round(s.n / seconds)}/s${s.coalesced ? "" : ", no coalesced events"}) · whole-pixel positions ${Math.round(100 * s.whole / s.n)}% · repeated ${s.same} · pressure at down ${s.down.toFixed(2)}, first move ${(s.first ?? 0).toFixed(2)} · ${devicePixelRatio}× screen`);
    });
    pad.addEventListener("contextmenu", (e) => { e.preventDefault(); note(`contextmenu · ${e.pointerType || "?"} · button ${e.button}`); });
    pad.addEventListener("touchstart", (e) => note(`touchstart · ${[...e.changedTouches].map((t) => t.touchType || "direct").join(", ")}`), { passive: true });
    $("penTestDialog").addEventListener("keydown", (e) => { if (e.key !== "Escape") note(`key · ${e.key} (${e.code})`); });
    $("penTestOpen").onclick = () => { closeMenus(); lines.length = 0; log.replaceChildren(); $("penTestDialog").showModal(); };
    $("penTestClose").onclick = () => $("penTestDialog").close();
    $("penTestSetup").onclick = () => { $("penTestDialog").close(); openPenSetup(); };
    $("penTestCopy").onclick = () => navigator.clipboard.writeText(lines.map((l) => l.text + (l.count > 1 ? ` ×${l.count}` : "")).join("\n")).then(() => status("Copied."), () => status("Select the lines and copy them.", true));
  }
}
