import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../App.css";
import "./management.css";
import { ManagementApp } from "./ManagementApp.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ManagementApp />
  </StrictMode>,
);
