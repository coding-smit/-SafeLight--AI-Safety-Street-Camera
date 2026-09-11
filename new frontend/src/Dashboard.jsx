import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TOKEN_STORAGE_KEY, USERNAME_STORAGE_KEY } from "./Login.jsx";

// Same AI service the camera page talks to. WebSocket URLs use ws:// or
// wss:// instead of http:///https:// - we derive it automatically below.
export const AI_SERVICE_URL = import.meta.env.SERVICE_URL || "http://localhost:8000";
function toWebSocketUrl(httpUrl, token) {
  const base = httpUrl.replace(/^http/, "ws") + "/ws/dashboard";
  return `${base}?token=${encodeURIComponent(token)}`;
}

// How many seconds without a new message before we consider a device
// "stale" (still shown, but flagged as not currently updating).
const STALE_AFTER_SECONDS = 8;

// WebSocket close code the backend uses when the token is missing/invalid.
const UNAUTHORIZED_CLOSE_CODE = 4401;

export default function Dashboard() {
  const navigate = useNavigate();
  const [connectionStatus, setConnectionStatus] = useState("connecting"); // connecting | connected | disconnected | unauthorized
  const [latest, setLatest] = useState(null); // most recent broadcast message
  const [lastUpdateAt, setLastUpdateAt] = useState(null);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const username = localStorage.getItem(USERNAME_STORAGE_KEY);

  const logout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USERNAME_STORAGE_KEY);
    navigate("/login");
  };

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);

    // Not logged in at all - don't even try to connect.
    if (!token) {
      navigate("/login");
      return;
    }

    let isUnmounted = false;

    const connect = () => {
      const currentToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!currentToken) {
        navigate("/login");
        return;
      }

      const ws = new WebSocket(toWebSocketUrl(AI_SERVICE_URL, currentToken));
      socketRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) return;
        setConnectionStatus("connected");
      };

      ws.onmessage = (event) => {
        if (isUnmounted) return;
        try {
          const data = JSON.parse(event.data);
          setLatest(data);
          setLastUpdateAt(Date.now());
        } catch (err) {
          console.error("Failed to parse dashboard message:", err);
        }
      };

      ws.onclose = (event) => {
        if (isUnmounted) return;

        if (event.code === UNAUTHORIZED_CLOSE_CODE) {
          // Token missing/invalid/expired - send them back to login.
          setConnectionStatus("unauthorized");
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          localStorage.removeItem(USERNAME_STORAGE_KEY);
          return;
        }

        setConnectionStatus("disconnected");
        // Try to reconnect automatically after a short delay.
        reconnectTimeoutRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) socketRef.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isStale =
    lastUpdateAt !== null && (Date.now() - lastUpdateAt) / 1000 > STALE_AFTER_SECONDS;

  const location = latest?.location || null; // {lat, lng, address} or null
  const hasLocation = !!location;
  const isAlert = latest?.alert === true;

  // Free, no-API-key OpenStreetMap embed centered on the camera's fixed location.
  const mapEmbedUrl = hasLocation
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${location.lng - 0.01}%2C${location.lat - 0.01}%2C${location.lng + 0.01}%2C${location.lat + 0.01}&layer=mapnik&marker=${location.lat}%2C${location.lng}`
    : null;

  // Opens Google Maps with turn-by-turn directions FROM the police
  // device's current location TO the camera's fixed location.
  const directionsUrl = hasLocation
    ? `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}&travelmode=driving`
    : null;

  if (connectionStatus === "unauthorized") {
    return (
      <div className="app">
        <main className="main login-main">
          <div className="login-card">
            <h2>Session expired</h2>
            <p className="login-subtext">
              Your login session is invalid or has expired. Please sign in again.
            </p>
            <button className="btn btn-primary" onClick={() => navigate("/login")}>
              Go to Login
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <h1>👮 Police Dashboard</h1>
          <p>Live SafeLight Monitoring{username ? ` — ${username}` : ""}</p>
        </div>
        <div className="header-right">
          <div className={`camera-status ${connectionStatus === "connected" ? "active" : "offline"}`}>
            <span className="dot" />
            {connectionStatus === "connected" ? "Live Feed Connected" : "Connecting..."}
          </div>
          <button className="btn btn-danger logout-btn" onClick={logout}>
            Log Out
          </button>
        </div>
      </header>

      <main className="main">
        {connectionStatus === "disconnected" && (
          <div className="banner error-banner">
            ⚠️ Lost connection to the AI service. Trying to reconnect...
          </div>
        )}

        {!latest && connectionStatus === "connected" && (
          <div className="banner warning-banner">
            Waiting for a camera device to start monitoring...
          </div>
        )}

        {isStale && (
          <div className="banner warning-banner">
            ⚠️ No new frames received in the last {STALE_AFTER_SECONDS}s. The camera device may have stopped monitoring.
          </div>
        )}

        {/* ---------------- Live snapshot ---------------- */}
        <div className="camera-container">
          {latest?.image_base64 ? (
            <img
              src={`data:image/jpeg;base64,${latest.image_base64}`}
              alt="Live camera feed"
              className="camera-video"
              style={{ objectFit: "contain", background: "#000" }}
            />
          ) : (
            <div className="camera-placeholder">
              <span>📡</span>
              <p>Waiting for live feed...</p>
            </div>
          )}

          {latest && (
            <div className={`detection-alert ${isAlert ? "danger" : "safe"}`}>
              {isAlert
                ? `🚨 ALERT: ${latest.person_count} PEOPLE DETECTED`
                : "SAFE"}
            </div>
          )}
        </div>

        {/* ---------------- Status dashboard ---------------- */}
        <div className="dashboard">
          <div className="card">
            <div className="card-icon">📷</div>
            <div className="card-label">Device</div>
            <div className="card-value">{latest?.device_id || "—"}</div>
          </div>

          <div className="card">
            <div className="card-icon">👤</div>
            <div className="card-label">People Detected</div>
            <div className="card-value">{latest?.person_count ?? 0}</div>
          </div>

          <div className="card">
            <div className="card-icon">🛡️</div>
            <div className="card-label">Alert Status</div>
            <div className={`card-value ${isAlert ? "value-alert" : "value-good"}`}>
              {isAlert ? "ALERT" : "SAFE"}
            </div>
          </div>

          <div className="card">
            <div className="card-icon">📍</div>
            <div className="card-label">Location</div>
            <div className="card-value">
              {hasLocation ? "REGISTERED" : "UNKNOWN"}
            </div>
          </div>
        </div>

        {/* ---------------- Map + directions ---------------- */}
        <div className="map-section">
          <h2>📍 Camera Location {hasLocation && `— ${location.address}`}</h2>
          {hasLocation ? (
            <>
              <div className="map-frame-wrapper">
                <iframe
                  title="Camera location map"
                  src={mapEmbedUrl}
                  className="map-frame"
                  loading="lazy"
                />
              </div>
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary directions-btn"
              >
                🧭 Get Directions to This Location
              </a>
              <p className="coords-text">
                Lat: {location.lat.toFixed(6)}, Lng: {location.lng.toFixed(6)}
              </p>
            </>
          ) : (
            <p className="footnote">
              This device isn't registered with a fixed location yet. Add it
              to DEVICE_LOCATIONS in ai-service/config.py.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
