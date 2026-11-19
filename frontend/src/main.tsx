import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "./fonts/geist/wght.css";
import "./fonts/geist-mono/wght.css";

import App from "./App";
import { AuthProvider } from "./lib/auth";
import "./styles.css";
import "./styles/accounts.css";
import "./styles/extensions.css";
import "./styles/documents.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
