import React from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";

import "./index.css";

const container = document.getElementById("root");

function showBootError(err) {
  const message = err?.stack || err?.message || String(err);
  // eslint-disable-next-line no-console
  console.error("App failed to start:", err);
  if (container) {
    container.innerHTML = `
      <div style="font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; padding: 24px; color: #111; background: #fff; border: 1px solid #fecaca; border-radius: 12px;">
        <h1 style="margin:0 0 8px; font-size: 20px;">App failed to load</h1>
        <p style="margin:0 0 12px; color:#64748b;">Open DevTools (F12) → Console for details.</p>
        <pre style="white-space: pre-wrap; font-size: 12px; background:#f8fafc; padding:12px; border-radius:8px; overflow:auto;">${String(message)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>
      </div>
    `;
  }
}

async function boot() {
  if (!container) {
    throw new Error("Root element #root was not found in index.html");
  }
  // Dynamic import so module-eval errors (bad imports) are catchable
  const { default: App } = await import("./App");
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

boot().catch(showBootError);

window.addEventListener("error", (event) => {
  if (!container || container.childElementCount > 0) return;
  showBootError(event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  if (!container || container.childElementCount > 0) return;
  showBootError(event.reason);
});
