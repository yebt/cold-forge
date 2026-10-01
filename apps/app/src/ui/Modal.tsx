import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { useScrollLock } from "./scrollLock.ts";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Bottom sheet on mobile instead of a centered dialog. */
  sheet?: boolean;
  closeLabel: string;
  /** Extra class on the dialog (e.g. a celebratory variant). */
  className?: string;
}

export function Modal({ title, onClose, children, sheet, closeLabel, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollLock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    // Focus the dialog once on open (not on every re-render), and give focus back on close.
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);
  return (
    <div className={`modal-backdrop${sheet ? " has-sheet" : ""}`} onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`modal${sheet ? " sheet" : ""}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={closeLabel}>
            <Icon name="close" size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
