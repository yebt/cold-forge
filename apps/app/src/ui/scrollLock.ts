import { useEffect } from "react";

/**
 * Reference-counted page scroll lock for dialogs. While any lock is held, `<html>` gets
 * `.scroll-locked` (overflow: hidden on the root only, never on body, see MOBILE.md). Every lock is
 * released by the effect cleanup, so unmounting a dialog for any reason (close, tab change, sign-out,
 * reset) always gives scrolling back. Nested dialogs keep the lock until the last one closes.
 */
let holders = 0;

function apply(): void {
  document.documentElement.classList.toggle("scroll-locked", holders > 0);
}

export function lockScroll(): () => void {
  holders++;
  apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    apply();
  };
}

export function useScrollLock(active = true): void {
  useEffect(() => (active ? lockScroll() : undefined), [active]);
}
