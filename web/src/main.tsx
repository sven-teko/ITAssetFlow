import {
  StrictMode,
} from "react";

import {
  createRoot,
} from "react-dom/client";

import {
  HashRouter,
} from "react-router-dom";

import "./index.css";
import "./App.css";

import App from "./App";


const rootElement =
  document.getElementById(
    "root",
  );


if (!rootElement) {
  throw new Error(
    "Das Root-Element der React-Anwendung wurde nicht gefunden.",
  );
}


createRoot(
  rootElement,
).render(
  <StrictMode>

    <HashRouter>

      <App />

    </HashRouter>

  </StrictMode>,
);
