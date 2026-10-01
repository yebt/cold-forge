import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { loadBackend } from "./backend/index.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

loadBackend().then(
  (backend) =>
    root.render(
      <StrictMode>
        <App backend={backend} />
      </StrictMode>,
    ),
  () => root.render(<p className="fatal">Failed to start. Check the Firebase configuration.</p>),
);
