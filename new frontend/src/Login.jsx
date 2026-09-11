import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

export const AI_SERVICE_URL = import.meta.env.SERVICE_URL || "http://localhost:8000";
export const TOKEN_STORAGE_KEY = "safelight_police_token";
export const USERNAME_STORAGE_KEY = "safelight_police_username";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("username", username);
      formData.append("password", password);

      const response = await fetch(`${AI_SERVICE_URL}/auth/login`, {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || "Login failed. Please check your credentials.");
        setSubmitting(false);
        return;
      }

      // Store the token so Dashboard.jsx can use it to open the
      // authenticated WebSocket connection.
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      localStorage.setItem(USERNAME_STORAGE_KEY, data.username);
      navigate("/dashboard");
    } catch (err) {
      setError("⚠️ Could not reach the AI service. Is it running?");
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <h1>👮 Police Login</h1>
          <p>SafeLight Dashboard Access</p>
        </div>
      </header>

      <main className="main login-main">
        <form className="login-card" onSubmit={handleSubmit}>
          <h2>Officer Sign In</h2>
          <p className="login-subtext">
            Authorized personnel only. Enter your SafeLight credentials to
            view live camera monitoring.
          </p>

          {error && <div className="banner error-banner">{error}</div>}

          <label className="login-label">
            Username
            <input
              type="text"
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label className="login-label">
            Password
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign In"}
          </button>

          <p className="login-hint">
            Demo credentials: <code>officer1</code> / <code>safelight123</code>
          </p>
        </form>
      </main>
    </div>
  );
}
