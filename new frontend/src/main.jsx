import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import Dashboard from "./Dashboard.jsx";
import Login, { TOKEN_STORAGE_KEY } from "./Login.jsx";
import "./App.css";

// Blocks access to the Police Dashboard route unless a login token is
// present in localStorage. This is a client-side convenience check
// only - the REAL enforcement happens on the backend, which rejects
// the dashboard WebSocket connection unless the token is valid
// (see ai-service/main.py -> /ws/dashboard).
function RequireAuth({ children }) {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

// Three pages, different devices can open them independently:
//   "/"           -> the camera device (phone) : SafeLight camera + AI
//   "/login"      -> police officer sign-in
//   "/dashboard"  -> the police viewer (any PC/phone) : live monitoring
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
