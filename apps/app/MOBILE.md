# Mobile scrolling and layout rules

The app runs in iOS Safari, the installed iOS PWA (`apple-mobile-web-app-capable`, standalone), Android Chrome,
the installed Android PWA and the Capacitor Android WebView. These rules keep scrolling native and reliable in
all of them. `src/styles.css` follows them; check this list before changing layout CSS.

## The scroll bug (fixed)

Scrolling didn't work on phones (reproduced on the deployed PWA). The causes were all in `src/styles.css`:

1. `html, body { overflow-x: hidden }`. Overflow on **both** `html` and `body` stops the viewport propagation of
   `overflow`, so `body` becomes its own scroll container inside a non-scrolling root. iOS Safari, and the
   standalone PWA in particular, then scroll badly or not at all (touches go to the root, which has nothing to
   scroll; momentum and the status-bar "scroll to top" break).
2. `background: … fixed` on `body`. Fixed backgrounds are unsupported on iOS and force full repaints while
   scrolling on Android; combined with (1) they made scrolling janky.
3. `overscroll-behavior-y: none` on `body`, which together with (1) applies to the inner scroller and swallows
   scroll chaining and the rubber-band at the edges.
4. A full-screen "perfect day" overlay (`position: fixed; inset: 0`) took every touch for 3 seconds.

## Rules

- **The document is the only page scroller.** No `overflow`, `height: 100%` locks, fixed backgrounds or
  `overscroll-behavior` on `html`/`body`. To stop stray horizontal overflow, use `overflow-x: clip` on the app
  wrapper (`.app`, `.onboarding`): unlike `hidden`, `clip` never creates a scroll container.
- **Dialogs lock scroll only while open**, through `ui/scrollLock.ts`: a reference-counted class
  (`html.scroll-locked { overflow: hidden }`) added by `<Modal>` and removed in the effect cleanup, so closing,
  Escape, tab changes, sign-out or reset (any unmount) always give scrolling back. Dialog scrollers use
  `overscroll-behavior: contain` so their scroll doesn't chain to the page.
- **Overlays never take touches unless they are interactive.** The sparks canvas and the perfect-day
  celebration are `pointer-events: none`. There is no `preventDefault()` on touch or wheel events and no
  `touch-action: none`. Buttons use `touch-action: manipulation` (no double-tap-zoom delay; panning still works).
- **Fixed chrome reserves its space.** The tab bar is `position: fixed` with `padding-bottom: safe-area`; every
  screen has `padding-bottom: tabbar height + safe area + 32px`, so the last item scrolls clear of it. Toasts sit
  above the tab bar. The onboarding CTA is `position: sticky` inside the flow, not fixed.
- **Safe areas.** `viewport-fit=cover` plus `env(safe-area-inset-*)` paddings (top for the notch and the
  `black-translucent` status bar of the iOS PWA, bottom for the home indicator, sides in landscape). On Android,
  Capacitor 8's SystemBars plugin (default `insetsHandling: "css"`) injects `--safe-area-inset-*` because older
  WebViews report `env()` as 0, so the tokens read `var(--safe-area-inset-top, env(safe-area-inset-top, 0px))`.
- **Viewport units.** `min-height: 100vh` with a `100dvh` override (the dynamic viewport follows the
  collapsing URL bar). Never `height: 100vh` on scrolling content.
- **Viewport meta:** `width=device-width, initial-scale=1, viewport-fit=cover`. No `user-scalable=no` /
  `maximum-scale` (pinch-zoom is an accessibility need). Inputs use `font-size: 16px` so iOS doesn't zoom on
  focus.
- **Transforms on screen containers** create a containing block for fixed descendants (toasts, dialogs). The
  screen entry animation is opacity-only.
- Switching tabs scrolls to the top, since the document scroll position is shared by all tabs.
- Respect `prefers-reduced-motion`: animations collapse to a frame, sparks don't render, tickers jump.

## How it's tested

Playwright with mobile emulation (`iPhone 13`, `Pixel 7`, `isMobile` + `hasTouch`) and real touch swipes over
CDP (`Input.dispatchTouchEvent`), on every screen with 9 habits, before and after opening/closing a dialog and
while the perfect-day overlay is up: the scroll position must move, reach the end, and the last element must sit
above the tab bar. Also no horizontal overflow at 320 and 390 px. Chromium can't reproduce WebKit's
nested-scroller behaviour, so (1) is prevented by rule, not only by test.
