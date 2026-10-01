import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { startPwa } from "./runtime.ts";
import { UpdateToast } from "./UpdateToast.tsx";

/** Follows `<html lang>`, which the app updates when the user changes language. */
function useHtmlLang(): string {
  const [lang, setLang] = useState(document.documentElement.lang);
  useEffect(() => {
    const observer = new MutationObserver(() => setLang(document.documentElement.lang));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => observer.disconnect();
  }, []);
  return lang;
}

function PwaRoot() {
  useHtmlLang(); // re-render on language change; UpdateToast reads the locale itself
  return <UpdateToast />;
}

/**
 * Side-effect entry imported once from main.tsx: registers the service worker, captures the
 * install prompt, and mounts the update toast in its own root so it works on every screen.
 */
startPwa();
const host = document.createElement("div");
host.id = "pwa-root";
document.body.append(host);
createRoot(host).render(
  <StrictMode>
    <PwaRoot />
  </StrictMode>,
);
