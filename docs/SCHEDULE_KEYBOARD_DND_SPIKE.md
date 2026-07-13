# SPIKE: Schedule Keyboard Drag-and-Drop

**Date**: 2026-07-04  
**Harness**: Docker E2E (Playwright + Chromium)  
**Status**: **BLOCKED** — keyboard DnD cannot drive ScheduleBoard's create path

## Investigation Summary

Three distinct problems were isolated and solved or characterized:

### 1. Input Dispatch — SOLVED

Playwright's `page.keyboard.press('Space')` synthesizes a click on the focused `<div role="button">` handle, and `@hello-pangea/dnd` cancels any in-progress drag on click (`use-keyboard-sensor.ts`). Also, `new KeyboardEvent(...)` leaves `keyCode=0`, but pangea reads `event.keyCode`, so synthetic events were ignored.

**Fix**: Dispatch raw `KeyboardEvent`s on `document.activeElement` with `keyCode`/`which` overridden via `Object.defineProperty`. This makes lift, move, and drop fire correctly (`Drag Start` → move keys → `Drag Operation Ended`, and `handleDragEnd` runs validation).

```typescript
const pressKey = async (key: string) => {
  await page.evaluate((k: string) => {
    const codes: Record<string, number> = {
      ' ': 32, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Escape: 27,
    };
    const code = codes[k] ?? 0;
    const target = document.activeElement || document.body;
    const mk = (type: 'keydown' | 'keyup') => {
      const ev = new KeyboardEvent(type, {
        key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true,
      });
      Object.defineProperty(ev, 'keyCode', { get: () => code });
      Object.defineProperty(ev, 'which', { get: () => code });
      return ev;
    };
    target.dispatchEvent(mk('keydown'));
    target.dispatchEvent(mk('keyup'));
  }, key);
  await page.waitForTimeout(40);
};
```

### 2. Arrow-Right Cancels — CHARACTERIZED

After any arrow move, focus leaves the handle (lands on `<body>`). A subsequent drop-Space synthesized via `keyboard.press` produces a click on `<body>`, which pangea treats as a cancel. The raw-KeyboardEvent approach sidesteps this entirely (no click synthesis), which is why it works where `keyboard.press` didn't.

### 3. Spatial Navigation — BLOCKER

With lift/move/drop all working, the drop still never lands on the target row. Pangea's `moveCrossAxis` (`state/move-in-direction/index.ts`) resolves the next droppable by nearest center-distance from the dragged item's start position. The sidebar sits left of the grid; its vertical center aligns with the Abwesenheiten ("Urlaub") section, so ArrowRight/ArrowDown always resolve to an Abwesenheiten cell. A 2-D sweep (ArrowDown 0..7 × ArrowRight 0..3) and pre-scrolling the target cell into view both failed — every drop landed on `Pos=Urlaub`, never on `Dienst Vordergrund`. This is intrinsic to `@hello-pangea/dnd`'s keyboard movement combined with this grid's layout.

## Conclusion

Keyboard DnD cannot be used to test ScheduleBoard's create path. The existing mouse helpers also fail (`destination: null`). Phase 3 stays High risk.

The raw-KeyboardEvent dispatch technique documented here is retained for any future attempt (e.g. if `@hello-pangea/dnd` is replaced by a library with deterministic keyboard navigation such as `dnd-kit`).
