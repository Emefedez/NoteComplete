# S Pen side button in the web build (Brave / Chrome on Android)

Research notes and an implementation plan for opening the quick menu with the S Pen side
button in the **web build** of NoteComplete running in **Brave (Chromium) on a Samsung
Android tablet or phone**.

Status: research and plan only. No code has been changed yet.

Labels used in this document:

- **[Verified]**: read in the source code or official documentation linked next to it.
- **[Reported]**: stated by a third party (forum, issue tracker, vendor FAQ), not checked on
  a device.
- **[Inferred]**: our own conclusion from the verified pieces; to be confirmed on a device
  with the calibration or the pen test dialog.

---

## 1. Summary

1. **Chromium on Android does not pass the S Pen side button through in a useful way while
   the pen touches the screen.** For a pen that touches the glass, Blink hard-codes
   `buttons = 1` (`button = 0` on `pointerdown`) and ignores every other button
   ([crbug.com/816504](https://crbug.com/816504), cited in the code). The current code's
   test, `(buttons & ~1) !== 0`, can never match during a stroke. **[Verified]**
2. **If the pen touches down with the button already held, Chromium takes the whole touch
   for its own "stylus text selection".** The page gets **no** `pointerdown`, `pointermove`
   or `touchstart`. A tap becomes a synthetic long press, which selects a word and fires
   `contextmenu` with **`pointerType === ""`** (empty). A drag selects text. This applies
   only when Android reports the button state as exactly `BUTTON_STYLUS_PRIMARY` or exactly
   `BUTTON_SECONDARY`. **[Verified]**
3. **While the pen hovers, the button only shows up as a change in `buttons` on hover
   `pointermove` events.** Android's `ACTION_BUTTON_PRESS`/`RELEASE` for a stylus are
   dropped ([crbug.com/592082](https://crbug.com/592082)), so no `pointerdown` or `pointerup`
   is sent. On hover moves, `BUTTON_STYLUS_PRIMARY` becomes **`buttons = 1`** (left), not 2.
   `BUTTON_SECONDARY` becomes 2, and both together become 3. The current test ignores
   `buttons === 1`. **[Verified]**
4. **Samsung can take the button before the browser sees it.** Air command can open on a
   press of the pen button while hovering. Some One UI versions drop all touch events while
   the button is held before contact. **[Reported]**
5. **Key events do not help.** Android's own stylus-button key codes
   (`KEYCODE_STYLUS_BUTTON_*`) are kept from apps by the system. Samsung Air actions
   (Bluetooth) send key events only to apps that declare them, and Brave declares none.
   **[Verified]** for AOSP; **[Reported]** for Samsung.
6. **Brave behaves like Chrome here.** Brave patches only `screenX` and `screenY` on
   mouse, pointer and touch events (fingerprint farbling). `button`, `buttons`,
   `pointerType` and `pressure` are untouched. **[Verified]**
7. **No web drawing app we checked handles the S Pen button in Chrome.** Excalidraw and
   tldraw only look at `button` 2 and 5. Goodnotes (a web app on Android) ships S Pen button
   support only in its Galaxy Store build, which requires Samsung Internet 23 or later, and
   users report it is unreliable. **[Verified]** for the code; **[Reported]** for Goodnotes.

**Likely cause of the user's report** (section 3): a press while touching is invisible to
the page, and a press while hovering arrives as `buttons === 1`, which the code ignores. The
one time it worked was most likely the button-tap path: a `contextmenu` with
`pointerType === ""` that the code accepted only because `lastPointerType` was still
`"pen"`. Any finger touch afterwards sets `lastPointerType` to `"touch"`, and later button
taps are then ignored.

**Plan** (section 4):

- Detect the button by **pen contact state**, not by bit masks. Any nonzero `buttons` on a
  pen `pointermove` with no pen contact means the side button.
- Accept **`contextmenu` with `pointerType === ""`** right after recent pen activity.
- Add a **calibration** ("Pen button: press it now") that records which signal this device
  produces and stores it in `localStorage`.
- Keep and extend the **fallbacks**: Shift + pen, Shift + S, two-finger hold, plus an
  optional pen long-press.

---

## 2. Findings

### 2.1 How Chromium on Android turns S Pen input into web events

All Chromium paths below are from the official GitHub mirror, `main` branch, read in
November 2026. The button mappings were also checked at tags `90.0.4430.0` and
`120.0.6099.0` and have not changed.

#### Two separate input paths

| Pen state | Android delivers | Chromium path | Web events |
|---|---|---|---|
| Touching the glass | `onTouchEvent` (`ACTION_DOWN/MOVE/UP`, `TOOL_TYPE_STYLUS`) | Touch path: `EventForwarder.sendTouchEvent`, then a `WebTouchEvent`, then pointer events | `pointerdown`/`move`/`up`, `pointerType "pen"`, plus `touchstart`… |
| Hovering | `onHoverEvent` (`ACTION_HOVER_MOVE`) | Mouse path: `EventForwarder.onHoverEvent`, `sendNativeMouseEvent`, then a `WebMouseEvent` with `pointer_type = pen` | `pointermove` (and `pointerover`/`out`), `pointerType "pen"` |
| Button pressed / released (any state) | `onGenericMotionEvent` (`ACTION_BUTTON_PRESS/RELEASE`) | **Dropped for stylus** | none |

Sources **[Verified]**:

- [`ui/android/java/src/org/chromium/ui/base/EventForwarder.java`](https://github.com/chromium/chromium/blob/main/ui/android/java/src/org/chromium/ui/base/EventForwarder.java):
  `onHoverEvent()` calls `sendNativeMouseEvent()` with the event's own tool type.
  `HOVER_ENTER` and `HOVER_EXIT` are ignored (crbug.com/715114).
- [`content/public/android/java/src/org/chromium/content/browser/ContentUiEventHandler.java`](https://github.com/chromium/chromium/blob/main/content/public/android/java/src/org/chromium/content/browser/ContentUiEventHandler.java):
  `onGenericMotionEvent` forwards `ACTION_BUTTON_PRESS/RELEASE` only when
  `getToolType(0) == TOOL_TYPE_MOUSE`. The code says:
  `// TODO(mustaq): Should we include MotionEvent.TOOL_TYPE_STYLUS here? https://crbug.com/592082`.
- Android documents that `ACTION_BUTTON_PRESS` "is not a touch event so it is delivered to
  `View#onGenericMotionEvent`"
  ([MotionEvent reference](https://developer.android.com/reference/android/view/MotionEvent#ACTION_BUTTON_PRESS)).
- AOSP's `TouchInputMapper` sends `HOVER_MOVE` with the current `buttonState`, and a
  separate `ACTION_BUTTON_PRESS` when a button goes down
  ([TouchInputMapper.cpp](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/main/services/inputflinger/reader/mapper/TouchInputMapper.cpp),
  `dispatchHoverEnterAndMove` and `dispatchButtonPress`).

#### Button bits

[`ui/events/android/event_flags_android.cc`](https://github.com/chromium/chromium/blob/main/ui/events/android/event_flags_android.cc)
(`EventFlagsFromAndroidButtonState`) and
[`ui/events/blink/blink_event_util.cc`](https://github.com/chromium/chromium/blob/main/ui/events/blink/blink_event_util.cc)
(`ToWebPointerButton`) give these mappings **[Verified]**:

| Android `buttonState` bit | Chromium flag, which becomes DOM `buttons` | DOM `button` |
|---|---|---|
| `BUTTON_PRIMARY` (1) | left, **1** | 0 |
| `BUTTON_SECONDARY` (2) | right, **2** | 2 |
| `BUTTON_STYLUS_PRIMARY` (32) | **left, 1** | 0 |
| `BUTTON_STYLUS_SECONDARY` (64) | right, 2 | 2 |
| `TOOL_TYPE_ERASER` (tool, not a button) | `buttons` 32, `pointerType "pen"` (only while touching) | 5 |

The eraser row comes from Blink's
[`pointer_event_factory.cc`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/events/pointer_event_factory.cc)
(`ConvertIdTypeButtonsEvent`). A hovering eraser is reported as a plain `"pen"` with
`buttons` 0 ("TODO(mustaq): Fix when the spec starts supporting hovering erasers").

So **an S Pen button reported as `BUTTON_STYLUS_PRIMARY` looks exactly like the left
button**. A third-party report says some Samsung devices report `34`
(`BUTTON_SECONDARY | BUTTON_STYLUS_PRIMARY`), which Chromium turns into `buttons = 3`
([Nomad Sculpt forum](https://forum.nomadsculpt.com/t/feedback-s-pen-button-negate-1-31/328)).
**[Reported]** Chromium's own code comments say Android before M reported the stylus button
as `BUTTON_SECONDARY`, and Android M and later report `BUTTON_STYLUS_PRIMARY`
([`stylus_text_selector.cc`](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/input/stylus_text_selector.cc)).
**[Verified]**

#### While touching: `buttons` is always 1

In `PointerEventFactory::ConvertIdTypeButtonsEvent` **[Verified]**:

```cpp
if (web_pointer_event.hovering) {
  buttons = MouseEvent::WebInputEventModifiersToButtons(...);   // real button state
} else {
  // TODO(crbug.com/816504): This is incorrect as we are assuming pointers
  // that don't hover have no other buttons except left which represents
  // touching the screen. This misconception comes from the touch devices and
  // is not correct for stylus.
  buttons = (pointerup || pointercancel) ? 0 : kLeft;
}
```

Touch points are also built with `0 /* no button changed */`
(`CreateWebTouchPoint` in `blink_event_util.cc`). **A pen that touches the screen always
reports `pointerdown button 0, buttons 1`, and `pointermove buttons 1`, whatever its side
button does.** Pressing the button in the middle of a stroke is invisible to the page.

#### While hovering: the button changes `buttons` on `pointermove`

Hover events go through the mouse path. `WebMouseEventBuilder::Build`
([`components/input/web_input_event_builders_android.cc`](https://github.com/chromium/chromium/blob/main/components/input/web_input_event_builders_android.cc))
copies the event flags into the modifiers. `WebPointerEvent` made from a mouse event has
`hovering = true`
([`web_pointer_event.cc`](https://github.com/chromium/chromium/blob/main/third_party/blink/common/input/web_pointer_event.cc)),
so Blink reports the real `buttons`. **[Verified]**

The result is a hover `pointermove` with `pointerType "pen"`, `button -1`, and `buttons`
1, 2 or 3 depending on the device. `pressure` is the Android pressure, normally 0 while
hovering, or 0.5 if it is NaN (`GetPointerEventPressure`). The pressure value is
**[Inferred]**. No `pointerdown` comes before it, and no `pointerup` comes after the
release. Only the next `pointermove` with `buttons 0`.

A Flutter user on a Galaxy Tab S6 Lite also saw the S Pen button "correctly appears in the
`PointerEvent.buttons` bitmask" while hovering
([flutter/flutter#42846](https://github.com/flutter/flutter/issues/42846)). **[Reported]**

#### Button held, then touch: Chromium's stylus text selection takes the touch

[`RenderWidgetHostViewAndroid::OnTouchEvent`](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/render_widget_host_view_android.cc)
passes every touch to `StylusTextSelector` before the page **[Verified]**:

```cpp
if (stylus_text_selector_.OnTouchEvent(event)) {
  RequestDisallowInterceptTouchEvent();
  return true;            // the page never sees this touch sequence
}
```

[`StylusTextSelector`](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/input/stylus_text_selector.cc)
starts on `ACTION_DOWN` when the tool is a stylus and
`buttonState == BUTTON_SECONDARY || buttonState == BUTTON_STYLUS_PRIMARY` (exact equality).
From then on it "Always return[s] true … This prevents forwarding of a partial touch stream".
**[Verified]**

- **Tap** (down and up without moving): `OnStylusSelectTap` sends a synthetic
  `GestureLongPress`. Blink selects the word under the pen, if there is one, and fires
  `contextmenu`. The gesture is built by `WebGestureEventBuilder::Build(type, time, x, y)`,
  which leaves `primary_pointer_type` as `kUnknown`. `GestureManager` copies it into the
  `contextmenu` event, and Blink names `kUnknown` as `""`. **So the event is a
  `contextmenu` with `pointerType === ""`, and no pointer or touch events come before
  it.** **[Verified]**
  - Sources:
    [`web_gesture_event.h`](https://github.com/chromium/chromium/blob/main/third_party/blink/public/common/input/web_gesture_event.h),
    [`gesture_manager.cc`](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/input/gesture_manager.cc)
    (`SendContextMenuEventForGesture`), and `pointer_event_factory.cc`
    (`PointerTypeNameForWebPointPointerType`).
- **Drag**: `OnStylusSelectBegin`, `Update` and `End` select text between the points
  (`SelectBetweenCoordinates`). The page sees only selection changes, if the content can be
  selected. **[Verified]** for the call; the exact DOM events are **[Inferred]**.
- If Samsung reports the combined value `34`, the exact-equality test fails. The touch then
  goes to the page as a normal pen touch, with `buttons 1` and the button invisible.
  **[Inferred]** from the code plus the [Reported] value 34.

#### Long press and the stylus button

Chromium's gesture detector can turn a stylus button into an immediate long press
(`stylus_button_accelerated_longpress_enabled`). This is **off on Android** and on only on
ChromeOS
([`gesture_detector.h`](https://github.com/chromium/chromium/blob/main/ui/events/gesture_detection/gesture_detector.h)).
**[Verified]**

A pen held still on the page for the long-press timeout still produces an ordinary long
press. It fires `contextmenu` with `pointerType "pen"` unless the page prevented the
`touchstart`. **[Verified]** for the code path. NoteComplete calls `preventDefault()` on
stylus `touchstart` in the drawing tools (app.js, "An Apple Pencil on the pages draws"), so
there this long press should not happen. **[Inferred]**

#### Samsung "S Pen to text" in Chromium

Chromium has a Samsung DirectWriting integration
([`DirectWritingTrigger.java`](https://github.com/chromium/chromium/blob/main/components/stylus_handwriting/android/java/src/org/chromium/components/stylus_handwriting/DirectWritingTrigger.java)).
It does **not** start handwriting while `BUTTON_STYLUS_PRIMARY` is pressed, and it can take
touch events only once writing has started in an editable field
(`EventForwarder.touchEventRequiresSpecialHandling`). **[Verified]** It is not a likely
cause on the pages canvas, but it can take pen touches over a focused text box.
**[Inferred]**

### 2.2 Samsung specifics

- **Air command**: Goodnotes' FAQ for "when I press the button on my S Pen, an icon and a
  popup opens up" says to go to **Settings → Advanced features → S Pen → Air command** and
  turn off **"Open Air command with Pen button"** and **"Show Air command icon"**
  ([Goodnotes support](https://support.goodnotes.com/hc/en-us/articles/7089900848527)).
  **[Reported]** When that option is on, the system opens Air command on a hover press, and
  the browser should not be expected to see that press. **[Inferred]** Labels differ
  between One UI versions.
- **Button held before touching**: Flutter users on Galaxy Tab S6 Lite, S7 and S7+ (One UI
  5.1, Android 13) get *no* touch events at all when the button is held before the pen
  touches the screen. The same users report Tab S9 FE and S9 Ultra on One UI 6.1
  (Android 14) work. Pressing the button after touching works
  ([flutter/flutter#42846](https://github.com/flutter/flutter/issues/42846)). **[Reported]**
  This applies to native apps, so it is below Chromium.
- **Button + drag selects text system-wide** (Samsung's "hold the S Pen button and drag over
  text or items to select"; [MakeTechEasier](https://maketecheasier.com/tips-and-tricks-to-using-the-s-pen-stylus),
  the S Pen Pro manual). **[Reported]** In Chromium this matches the `StylusTextSelector`
  behaviour above.
- **Air actions (Bluetooth S Pen)**: Samsung's framework "checks for the foreground app and
  looks for the KeyEvent that the app made public", and sends it to that app's
  `KeyEvent.Callback`. Apps declare this in a `<remote-actions>` XML resource
  ([Samsung Air Actions docs](https://developer.samsung.com/galaxy-spen-remote/air-actions.html),
  [codelab](https://developer.samsung.com/codelab/s-pen-remote/air-actions.html)).
  **[Reported]** (seen through search summaries; Samsung's site was not reachable from this
  environment). Brave declares none, so Air actions single or double presses do nothing in
  the page, apart from the system-wide "Anywhere actions" and the General (camera and media)
  actions. **[Inferred]** Samsung's own developer forum answered a web developer that "S Pen
  events can be detected using S Pen Remote SDK on your Android apps. JavaScript support /
  Browser event is not available"
  ([Samsung forum, 2020](https://forum.developer.samsung.com/t/how-to-handle-samsung-s-pen-button-event-in-the-browser-javascript/7914)).
  **[Reported]**
- **Android stylus-button key codes**: Android 14 added `KEYCODE_STYLUS_BUTTON_PRIMARY`
  (308), `SECONDARY`, `TERTIARY` and `TAIL`. AOSP `PhoneWindowManager.interceptKeyBeforeQueueing`
  always clears `ACTION_PASS_TO_USER` for them, so **apps never receive them**
  ([PhoneWindowManager.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/policy/PhoneWindowManager.java)).
  Chromium has no DOM key mapping for them either
  ([`keyboard_code_conversion_android.cc`](https://github.com/chromium/chromium/blob/main/ui/events/keycodes/keyboard_code_conversion_android.cc)).
  **[Verified]** for AOSP; Samsung may differ.
- **Android "stylus buttons" setting**: AOSP has `Settings.Secure.STYLUS_BUTTONS_ENABLED`.
  When it is off, `InputReader` strips `BUTTON_STYLUS_PRIMARY` and `BUTTON_STYLUS_SECONDARY`
  from motion events (`filterButtonState`, `stylusButtonMotionEventsEnabled`)
  ([Settings.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/android/provider/Settings.java),
  [InputReaderBase.h](https://android.googlesource.com/platform/frameworks/native/+/refs/heads/main/services/inputflinger/include/InputReaderBase.h)).
  **[Verified]** for AOSP. Whether One UI shows this setting is unknown.
- **Samsung developer forum**: "the only way to use the button is through the android
  events, where the event.buttonState will have the state of the spen button"
  ([Tab S9 FE+ thread](https://forum.developer.samsung.com/t/galaxy-tab-s9-fe-cant-get-any-spen-specific-events/38112)).
  **[Reported]** So the button reaches Chromium only as `buttonState`, which is the
  analysis above.

### 2.3 What other apps do

- **Samsung Notes and other native apps** read `MotionEvent.getButtonState()` (or the S Pen
  SDK) in `onTouchEvent` and `onHoverEvent`. They see the button while touching, which a web
  page in Chromium cannot. **[Inferred]** from the Samsung forum answer above and Android's
  [stylus documentation](https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/advanced-stylus-features).
- **Excalidraw** ([`App.tsx`](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/components/App.tsx),
  [`constants.ts`](https://github.com/excalidraw/excalidraw/blob/master/packages/common/src/constants.ts)):
  `POINTER_BUTTON.ERASER = 5` switches to the eraser on `pointerdown`. `SECONDARY = 2` is
  right-click. There is no S Pen specific code. **[Verified]**
- **tldraw** ([`useCanvasEvents.ts`](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/hooks/useCanvasEvents.ts),
  [`pointer.ts`](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/utils/pointer.ts)):
  accepts `button` 0, 1, 2 and 5 on `pointerdown`. 2 is the context menu and 5 is the
  eraser. There is no S Pen specific code. **[Verified]** By the analysis above, neither
  app's button handling can fire for an S Pen in Chrome on Android. **[Inferred]**
- **Obsidian Excalidraw plugin**: its pen tracking issue lists S Pen button support as an
  open request
  ([zsviczian/obsidian-excalidraw-plugin#2773](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/2773)).
  **[Verified]**
- **Goodnotes for Android** (web technology): S Pen button support (hold for eraser, click
  to toggle) needs the **Galaxy Store build and Samsung Internet 23 or later**
  ([Goodnotes support](https://support.goodnotes.com/hc/en-us/articles/8373153754639)). Users
  report it "does not switch to the eraser most of the time" and "works if I move the spen
  away from the screen and then hold the button"
  ([Goodnotes feedback](https://feedback.goodnotes.com/forums/950440-improve-goodnotes-for-android-windows-web/suggestions/46460491-s-pen)).
  **[Reported]** This fits a hover-only signal. The Samsung Internet requirement suggests
  Samsung's browser exposes the button in a way Chrome and Brave do not. **[Inferred]**
- **Miro and Concepts**: nothing public found about S Pen button detection in a browser.
  Concepts' Android app uses Samsung Air actions, a native API
  ([Concepts help](https://tophatch.helpshift.com/hc/en/3-concepts/faq/204-how-to-set-samsung-air-actions-for-concepts)).
  **[Reported]**
- **Pointer Events spec**: a barrel button pressed while hovering is a known gap. The spec
  lets `buttons` change on hover `pointermove`, but no `pointerdown` is required
  ([w3c/pointerevents#290](https://github.com/w3c/pointerevents/issues/290),
  [2015 discussion](https://lists.w3.org/Archives/Public/public-pointer-events/2015AprJun/0123.html)).
  **[Verified]**

**No web app was found that has the S Pen button working reliably in Chrome or Brave.**

### 2.4 Brave compared with Chrome

- Brave Android uses Chromium's content layer and Java `EventForwarder` without changes.
  brave-core has no `chromium_src` override for `ui/android` input or `ContentUiEventHandler`.
  **[Verified]** by listing `brave-core/chromium_src`.
- Brave's only changes to input events are fingerprint farbling of `screenX` and `screenY`
  on `MouseEvent`, `PointerEvent` and `Touch`
  ([brave-core `chromium_src/.../events/mouse_event.h`](https://github.com/brave/brave-core/blob/master/chromium_src/third_party/blink/renderer/core/events/mouse_event.h),
  [`pointer_event.h`](https://github.com/brave/brave-core/blob/master/chromium_src/third_party/blink/renderer/core/events/pointer_event.h),
  [`input/touch.h`](https://github.com/brave/brave-core/blob/master/chromium_src/third_party/blink/renderer/core/input/touch.h)).
  `button`, `buttons`, `pointerType`, `pressure` and `clientX/Y` are untouched. NoteComplete
  uses `clientX/Y`. **[Verified]**
- Brave follows Chromium releases closely. All the behaviour in 2.1 has been stable for
  years, so its exact Chromium version does not matter here. **[Inferred]**
- No Brave flag changes this. **[Inferred]** No `chrome://flags` entry was found for
  stylus buttons; the accelerated long press is a compile-time default.

---

## 3. Likely causes of the user's failure

These are in order of likelihood. All are **[Inferred]** from section 2, and the pen test
dialog can confirm them (section 6).

1. **Pressing while touching never reaches the page.** Holding the button and then touching
   means `StylusTextSelector` takes the touch (or One UI drops it). Pressing mid-stroke
   leaves `buttons` at 1 (crbug.com/816504). The current `pointerdown` check
   (`e.button > 0 || penButton(e.buttons)`) cannot match.
2. **Pressing while hovering gives `buttons === 1`.** `penButton = (buttons & ~1) !== 0`
   was written for desktop (barrel = 2, eraser = 32), so it ignores the value that
   `BUTTON_STYLUS_PRIMARY` produces. A device that reports `34` gives 3 and would work, so
   results vary by device.
3. **The button-tap path is accepted only by luck.** A button + tap gives
   `contextmenu` with `pointerType ""`. The handler then falls back to `lastPointerType`,
   which only `pointerdown` sets. `StylusTextSelector` sends no `pointerdown`, so
   `lastPointerType` still holds whatever touched last. After the pen writes, it is `"pen"`
   and the menu opens: **"it worked once"**. After any finger touch (scroll, pinch, tapping
   a menu item with a finger) it is `"touch"`, and every later button tap is ignored until
   the pen writes again.
4. **Air command takes hover presses** when "Open Air command with pen button" is on.
5. **Pressing out of hover range** (more than roughly 1 to 1.5 cm above the screen) is a
   Bluetooth Air actions press. Brave never sees it. **[Inferred]**

---

## 4. Implementation plan for the web build

### 4.1 Signals to listen for, most likely first

| # | Gesture | What the page receives in Chromium/Brave on Android | Use |
|---|---|---|---|
| A | **Hover, press button** | Pen `pointermove` with `buttons` going 0 → nonzero (1, 2 or 3) and **no pen contact**; `pressure` 0 (or 0.5); no `pointerdown` | **Primary signal.** Open the menu on the rising edge. |
| B | **Hold button, tap the page** | Only a `contextmenu` with `pointerType ""` (`button` may be 0 or -1), right after pen hover moves; perhaps a word selection | **Second signal.** Open the menu, call `preventDefault()`, clear the selection. |
| C | Hold button, drag | Text selection only; no pointer events | Ignore, but stop it selecting: the pages already have `user-select: none` in touch mode (`style.css`, `body.touch-pointer .sheet`) |
| D | Pen touches, then press button | Nothing; `buttons` stays 1 | Cannot be detected. Tell the user. |
| E | Pen long-press (opt-in fallback) | Pen `pointerdown`, no movement for about 550 ms | Fallback when A and B fail |
| F | Desktop or Windows pens (Wacom, Surface) | `pointerdown` with `button` 2 or 5, or `buttons & 2` / `& 32`, or a hover `pointermove` with `buttons` 2 | Keep the existing behaviour |
| G | Key events | Nothing in AOSP. A Samsung build *might* send something; only calibration would show it | Accept only if calibration recorded a key |

### 4.2 Code changes (app.js, around `penButton`/`penMenu`, about lines 2136–2176)

Put the decision logic in a small pure module, **`apps/reader/pen-button.js`**, and test it
in **`apps/reader/pen-button.test.mjs`** (same style as the other `*.test.mjs` files). The
module takes plain event fields (`type`, `pointerType`, `button`, `buttons`, `pressure`,
`time`) plus its state, and returns `"menu"` or `null`. This lets us replay the lines from
the pen test dialog in unit tests.

Sketch:

```js
// pen-button.js — whether a pen event is its side button, however this browser reports it.
export function penButtonDetector(profile = null) {
  let contact = false;      // a pen pointerdown seen, no pointerup/cancel yet
  let hoverButtons = 0;     // buttons on the last hovering pen pointermove
  let penSeenAt = -Infinity; // last pen event of any kind (hover included)
  const hoverMask = profile?.hoverMask ?? ~0;   // calibrated bits, or any bit
  return {
    pointer(e) {            // pointerdown / pointermove / pointerup / pointercancel
      if (e.pointerType !== "pen") return null;
      penSeenAt = e.time;
      if (e.type === "pointerdown") {
        contact = true;
        // Desktop pens: barrel (2) or eraser (5) on contact. Never fires on Android (buttons is 1).
        return e.button > 0 || (e.buttons & ~1) ? "menu" : null;
      }
      if (e.type === "pointerup" || e.type === "pointercancel") { contact = false; hoverButtons = 0; return null; }
      // pointermove
      if (contact) return null;                    // touching: Chrome on Android hides the button
      const was = hoverButtons & hoverMask, now = e.buttons & hoverMask;
      hoverButtons = e.buttons;
      return now && !was ? "menu" : null;          // rising edge while hovering
    },
    contextmenu(e) {
      if (e.pointerType === "pen" && profile?.longPress) return "menu";
      // Button + tap: Chromium's stylus text selection sends a long press with no pointer type.
      if (e.pointerType === "" && e.time - penSeenAt < 1500 && !contact) return "menu";
      return null;
    },
    key(e) { return profile?.key && e.code === profile.key.code && e.key === profile.key.key ? "menu" : null; },
    reset() { hoverButtons = 0; },   // quick menu closed: the next press counts again
  };
}
```

How it plugs into the existing code:

- Replace `penButton`, `lastPenButtons` and the three listeners with one detector
  (`const penBtn = penButtonDetector(loadPenProfile())`). Feed it from the capture
  listeners that already exist on `document`:
  - `pointermove`: call `penBtn.pointer(...)`. On `"menu"` and `onPages(e)`, call
    `penMenu(e)`. Keep the `penHover` bookkeeping for Shift.
  - `pointerdown`: keep `lastPointerType`, and keep `e.shiftKey`: **Shift + pen** stays.
    On `"menu"`, call `preventDefault()`, `stopPropagation()` and `penMenu(e)`, as now.
  - `pointerup`, `pointercancel`: feed the detector (this replaces the `lastPenButtons`
    loop). Do **not** feed `pointerleave`. On Android, a hover pointer leaving the page
    must not count as the end of contact.
  - `contextmenu`: on `"menu"` and `onPages(e)`, call `preventDefault()`,
    `stopPropagation()`, `getSelection()?.removeAllRanges()` and `penMenu(e)`. Keep the
    800 ms `penMenuAt` guard, so the browser's own menu does not appear after ours.
  - `keydown`: only if a calibrated key exists.
- `quickMenu({ onClose })`: call `penBtn.reset()` instead of `lastPenButtons = 0`.
- **Safety check for rule A**: no other web source sends a pen `pointermove` with nonzero
  `buttons` and no `pointerdown` before it, so the rule is safe on desktop too. A desktop
  pen hovering with the barrel pressed gives `buttons` 2, which the old code already
  treated as the button. **[Inferred]**
- **Contact going stale**: if a `pointerup` is ever lost, a later pen `pointermove` with
  `buttons === 0` should also clear `contact`. Hover moves always have 0 once the button
  is released.
- **Pages CSS**: `notePen()` in app.js (about line 1483) already sets
  `body.touch-pointer` on any non-mouse `pointerdown`, which includes a pen. In style.css
  that class turns on `user-select: none` for `.sheet` and `.text-layer`. Signals B and C
  bring no `pointerdown`, though, so the class reflects the last *pointerdown*. Also set it
  from pen hover `pointermove`s, and clear any selection when signal B fires. Otherwise B's
  word selection or C's drag selection can highlight PDF text after a mouse was last used.
- **Reuse `lastPen`**: `notePen()` already records the time of the last pen event, hover
  included (`lastPen`, `performance.now()`). The detector's `penSeenAt` can use it. Read
  `e.timeStamp` or `performance.now()` consistently, not `Date.now()`.

### 4.3 Calibration: "Pen button: press it now"

**Where:** View menu (next to "Auto-open tool settings"), item **"Pen button…"**. Also add
a **"Set up the pen button…"** button at the bottom of Help → Test pen and stylus. It opens
a small dialog that reuses the `deck-dialog` style and a `.pen-test-pad`-style area.

**Flow:**

1. **Baseline (2 s)**: "Hold your pen just above the box without touching it." Record the
   hover `pointermove` events (`buttons`, `pressure`). This gives the baseline `buttons`
   (expected 0) and confirms that hover events arrive at all. If no pen hover events
   arrive, report it ("This browser does not report the pen hovering") and skip to step 3.
2. **Hover press**: "Without touching, press and release the side button." Record, for
   5 s or until two presses are seen:
   - pen `pointermove` with `buttons` different from the baseline. Store `hoverMask` as
     the bits that appeared (for example `1`, `2` or `3`) and the `pressure` seen;
   - any `contextmenu`, `keydown` or `keyup` (`key`, `code`, `keyCode`);
   - `pointerType` changes (for example `"pen"` to `"eraser"` style values: `buttons 32` or
     `button 5`).
3. **Tap with the button held**: "Hold the button and tap the box once." Record
   `contextmenu` (with its `pointerType` and `button`), and whether any `pointerdown`,
   `touchstart` or `selectionchange` came before it.
4. **Result**: show in plain words what was found, for example "Your pen button works
   when the pen hovers (reported as buttons 1) and when you tap with it held." Offer
   **Use this** / **Try again** / **Turn the pen button off**.

**Stored value** (`localStorage`, key `notecomplete-pen-button`, wrapped in `try`, like
the other settings in app.js):

```json
{
  "v": 1,
  "ua": "Chrome/142 Android",
  "hoverMask": 1,
  "hoverPressure": 0,
  "tapContextmenu": "",
  "key": null,
  "longPress": false,
  "off": false,
  "at": "2026-11-02T10:00:00Z"
}
```

- `loadPenProfile()` returns `null` when nothing is stored or the stored `ua` major version
  no longer matches. The defaults then apply: any hover bit, `contextmenu ""` after pen
  activity, and the desktop rules.
- `off: true` disables signals A, B and G (for users whose Air command fights with the
  app). It keeps Shift + pen, Shift + S and two-finger hold.
- Calibration narrows signals, it never disables the defaults. For example, if step 2
  found nothing but step 3 found `contextmenu ""`, keep both rules on: the user may have
  pressed out of hover range during step 2.

**Feasibility** **[Inferred]**: everything recorded here (pointer fields, `contextmenu`,
key events, selection events) is visible to page JavaScript, so calibration is
straightforward. Its limit is that it cannot create signals the browser drops. A press
while touching (D) can never be calibrated in Chrome or Brave.

### 4.4 Fallbacks when the button is unusable

These already exist; keep them and list them in the dialog and the user guide:

- **Shift + pen** on `pointerdown`, and **Shift while the pen hovers** (`penHover`).
- **Shift + S**.
- **Two fingers held still** on the page (`touchGestures({ menu })` in touch.js).

New, as opt-in settings in the "Pen button…" dialog:

- **Pen long-press**: "Hold the pen still on the page to open the menu." Set a timer on pen
  `pointerdown` on the pages. If the pen moves less than about 4 px for 550 ms, call
  `cancelGesture()` (drop the dot of ink) and then `penMenu(e)`. Off by default, because it
  interferes with careful slow writing and dots. Use our own timer rather than the browser
  long press. In the drawing tools, the browser's long press is suppressed because those
  tools call `preventDefault()` on stylus `touchstart`.
- **Optional, cheap**: a **pen double-tap on empty margin** (outside the sheets) opens the
  menu. Only worth adding if users ask.

### 4.5 What to tell users (Samsung settings)

Put this in the "Pen button…" dialog, in docs/USER_GUIDE.md (which already has one Air
command sentence at line 165), and in the welcome notebook's Keys and gestures page:

- **Press the button while the pen hovers just above the page** (the hover pointer
  visible, under about 1 cm), **not while it touches**. In Chrome and Brave on Android, a
  press while touching does not reach web pages.
- Or **hold the button and tap the page once**.
- If a small Samsung menu (Air command) opens instead: **Settings → Advanced features →
  S Pen → Air command** → turn off **Open Air command with pen button**. The exact wording
  varies by One UI version
  ([Goodnotes FAQ](https://support.goodnotes.com/hc/en-us/articles/7089900848527)).
- If you used the S Pen's Bluetooth remote (Air actions), the press must be made with the
  pen near the screen. Air actions presses with the pen away do not reach browsers.
- If text gets highlighted when you tap with the button held, that is the browser's
  "select with pen button". Run **View → Pen button…** again, or use the long-press
  option.
- "S Pen to text" can take pen input in text boxes. If writing in NoteComplete's text
  boxes behaves oddly, turn it off in **Settings → Advanced features → S Pen**.
- If nothing works, use **Shift + pen**, **Shift + S**, **two fingers held still**, or
  the **pen long-press** option. If neither the hover press nor the tap works in Brave,
  **Samsung Internet** may behave differently (Goodnotes requires it for its S Pen
  button). This is **[Inferred]**; test it before recommending it.

### 4.6 Verifying with Help → Test pen and stylus

**Small changes to the dialog** (`penTestDialog` code in app.js about line 4048, and
index.html line 1123):

- Log `pointerType` as `""` explicitly (today `contextmenu` logs `e.pointerType || "?"`).
  Use `"(none)"` so the button-tap signal can be recognised.
- Add the pen state to each line: **`hover`** or **`contact`** (from our own
  `pointerdown`/`pointerup` tracking). This shows `pointermove · pen · buttons 1 · hover`.
- Log `pointerover`, `pointerout`, `selectionchange` and `selectstart`, and `keyup` as well
  as `keydown`. Listen on `document` while the dialog is open, not only on the dialog. Add
  `e.isPrimary` and `e.pointerId` to pointer lines.
- Collapse repeated hover moves. The existing ×count does this, but `pressure` changes
  break the run, so round `pressure` for hover lines.
- Add the **"Set up the pen button…"** button (section 4.3).

**Expected logs per hypothesis** (for the user to copy with **Copy** and send back):

| What the user does | If section 2 is right, the log shows | Meaning |
|---|---|---|
| Hover, press button | `pointermove · pen · buttons 1 (or 2/3) · pressure 0.00 · hover` | Signal A works; old code missed `buttons 1` |
| Hover, press button | only `pointermove … buttons 0` lines, maybe a `pointerout` | Air command or One UI took it. Change the setting and retry |
| Hold button, tap | `contextmenu · (none) · …`, no `pointerdown` before it | Signal B (StylusTextSelector) |
| Hold button, tap | `pointerdown · pen · button 0 · buttons 1` | Device reports 34: rule A on hover still works, B does not |
| Hold button, tap | nothing at all | One UI drops the touch (Flutter report). Use hover or the fallbacks |
| Touch, then press | `pointermove … buttons 1` unchanged | Expected: crbug.com/816504 |

**Unit tests**: put several of these logs, as event-field sequences, into
`pen-button.test.mjs`:

- hover press with `buttons 1`;
- the `contextmenu ""` tap, with a pen hover just before it and with a finger touch just
  before it;
- a normal stroke whose `buttons 1` must not open the menu;
- a desktop barrel `pointerdown button 2`;
- a finger long-press `contextmenu "touch"`, which must not open the menu.

**On-device check before release**: Brave and Chrome on one Galaxy tablet (ideally one
One UI 5.x and one 6.x or later), with the Air command pen-button option both on and off.
Repeat each gesture ten times, in a draw tool and in Pan/Select, to catch accidental opens.

---

## 5. Verified vs inferred, at a glance

| Statement | Status |
|---|---|
| Touching pen always reports `buttons 1` in Blink | Verified (Chromium source, crbug.com/816504) |
| Stylus `ACTION_BUTTON_PRESS/RELEASE` dropped | Verified (Chromium source, crbug.com/592082) |
| Hover `pointermove` carries the button in `buttons`; `STYLUS_PRIMARY` becomes 1 | Verified (Chromium source) |
| Button held at touch-down: touch taken for text selection; tap gives `contextmenu` with `pointerType ""` | Verified (Chromium source) |
| Stylus-button accelerated long press is off on Android | Verified (Chromium source) |
| AOSP never passes `KEYCODE_STYLUS_BUTTON_*` to apps | Verified (AOSP source) |
| Brave changes only `screenX/Y` on input events | Verified (brave-core source) |
| Excalidraw and tldraw only use `button` 2 and 5 | Verified (their source) |
| Samsung reports the button as 32 or as 34 | Reported (forum), varies by device |
| Air command option takes hover presses | Reported (Goodnotes FAQ) |
| One UI ≤ 5.1 drops touches when the button is held first | Reported (Flutter issue) |
| Air actions key events go only to apps that declare them | Reported (Samsung docs via search) |
| Hover `pressure` is 0 with the button pressed | Inferred |
| "Worked once" came from `lastPointerType` still being `"pen"` | Inferred |
| Samsung Internet exposes the button differently | Inferred (from Goodnotes' requirement) |

Sources that could not be opened from the research environment (network allow-list):
forum.developer.samsung.com, developer.samsung.com, support.goodnotes.com,
forum.nomadsculpt.com, codereview.chromium.org. Statements from them are based on
search-result excerpts and are marked **[Reported]**.
