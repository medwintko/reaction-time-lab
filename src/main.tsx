import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// React attaches the entire interactive laboratory to the root element in index.html.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
