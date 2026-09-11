import React, { useRef, useState, useEffect, useCallback } from "react";

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
// URL of the Python AI service. Change this if the AI service runs
// on a different host/port (e.g. when testing from a phone on LAN).
export const AI_SERVICE_URL = import.meta.env.SERVICE_URL || "http://localhost:8000";
// Simple device identifier for this camera module.
// Later this can be replaced with a real per-device identifier.
const DEVICE_ID = "PHONE-001";

// How often we sample frames and send them to the AI service.
// 350ms ≈ ~2.8 frames per second (within the 2-5 fps target).
const CAPTURE_INTERVAL_MS = 350;

// How long we wait for the AI service to respond before giving up
// on a single frame (prevents requests piling up if the server hangs).
const DETECT_TIMEOUT_MS = 4000;

export default function App() {
  // ---------------- Refs ----------------
  const videoRef = useRef(null); // visible <video> element (live preview)
  const captureCanvasRef = useRef(null); // hidden canvas used to grab frames
  const overlayCanvasRef = useRef(null); // canvas drawn on top of video for bounding boxes
  const streamRef = useRef(null); // MediaStream reference (for cleanup)
  const intervalRef = useRef(null); // setInterval id for monitoring loop
  const isProcessingRef = useRef(false); // prevents overlapping AI requests
  const abortControllerRef = useRef(null); // to cancel a stuck fetch request
  // Note: this device's location is NOT tracked live via GPS. SafeLight
  // cameras are meant to be fixed/mounted, so each device's location is
  // registered once on the backend (ai-service/config.py) and looked up
  // by device_id - see DEVICE_ID below.

  // ---------------- State ----------------
  const [cameraActive, setCameraActive] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [personCount, setPersonCount] = useState(0);
  const [detections, setDetections] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [aiOffline, setAiOffline] = useState(false);

  // ------------------------------------------------------------------
  // CAMERA: Start
  // ------------------------------------------------------------------
  const startCamera = useCallback(async () => {
    setErrorMessage("");

    // Browsers require a secure context (https, or localhost) to allow
    // camera access. Warn the user early if that's likely the problem.
    if (!window.isSecureContext) {
      setErrorMessage(
        "⚠️ Camera requires a secure context (HTTPS) or localhost. If you're opening this on a phone via a plain LAN IP (http://192.168.x.x), the browser may block camera access. Use HTTPS or a secure tunnel."
      );
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setErrorMessage("⚠️ Camera is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Some mobile browsers need an explicit play() call.
        await videoRef.current.play().catch(() => {});
      }

      setCameraActive(true);
      setErrorMessage("");
    } catch (err) {
      // Give user-friendly messages based on the error type.
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setErrorMessage("⚠️ Camera access denied. Please allow camera permission and try again.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setErrorMessage("⚠️ No camera device found on this device.");
      } else if (err.name === "NotReadableError") {
        setErrorMessage("⚠️ Camera is already in use by another application.");
      } else {
        setErrorMessage("⚠️ Unable to access camera. " + (err.message || ""));
      }
      setCameraActive(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // CAMERA: Stop
  // ------------------------------------------------------------------
  const stopCamera = useCallback(() => {
    // Stop monitoring first (clears interval, resets monitoring state).
    stopMonitoring();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setPersonCount(0);
    setDetections([]);
    clearOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // OVERLAY DRAWING
  // ------------------------------------------------------------------
  const clearOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const drawBoundingBoxes = (boxes, videoWidth, videoHeight) => {
    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    // Match the overlay canvas's internal resolution to the video's
    // native resolution. CSS (width:100%; height:100%) scales it to
    // match the displayed preview size, so box coordinates line up.
    canvas.width = videoWidth;
    canvas.height = videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    boxes.forEach((det) => {
      const [x1, y1, x2, y2] = det.bbox;
      const width = x2 - x1;
      const height = y2 - y1;

      ctx.strokeStyle = "#ff3b30";
      ctx.lineWidth = Math.max(2, videoWidth * 0.003);
      ctx.strokeRect(x1, y1, width, height);

      const label = `Person ${Math.round(det.confidence * 100)}%`;
      ctx.font = `${Math.max(16, videoWidth * 0.02)}px sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const textHeight = Math.max(20, videoWidth * 0.026);

      ctx.fillStyle = "#ff3b30";
      ctx.fillRect(x1, Math.max(0, y1 - textHeight), textWidth + 12, textHeight);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x1 + 6, Math.max(textHeight - 5, y1 - 5));
    });
  };

  // ------------------------------------------------------------------
  // FRAME CAPTURE + SEND TO AI SERVICE
  // ------------------------------------------------------------------
  const captureAndDetect = useCallback(async () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;

    if (!video || !canvas) return;
    if (video.readyState < 2) return; // video not ready yet
    if (isProcessingRef.current) return; // skip if a request is already in flight

    isProcessingRef.current = true;

    try {
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      if (!videoWidth || !videoHeight) {
        isProcessingRef.current = false;
        return;
      }

      canvas.width = videoWidth;
      canvas.height = videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

      // Convert the canvas frame to a JPEG blob for upload.
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.8)
      );

      if (!blob) {
        isProcessingRef.current = false;
        return;
      }

      const formData = new FormData();
      formData.append("file", blob, "frame.jpg");
      // The backend looks up this device's fixed, registered location
      // (ai-service/config.py) by device_id - no GPS needed here.
      formData.append("device_id", DEVICE_ID);

      // Guard against a hung request with a timeout.
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

      const response = await fetch(`${AI_SERVICE_URL}/detect`, {
        method: "POST",
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`AI service responded with status ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        // Backend explicitly reported a problem (e.g. invalid image).
        setAiOffline(false);
        return;
      }

      setAiOffline(false);
      setPersonCount(data.person_count || 0);
      setDetections(data.detections || []);
      drawBoundingBoxes(data.detections || [], videoWidth, videoHeight);

      // Build and log the detection event for future backend integration.
      if (data.person_count > 0) {
        const event = {
          device_id: DEVICE_ID,
          person_count: data.person_count,
          event: "PERSON_DETECTED"
        };
        console.log("Detection Event:", event);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.warn("AI detection request timed out.");
      } else {
        console.error("AI detection failed:", err);
      }
      // Mark the AI service as unavailable so the UI can show a warning,
      // but keep monitoring running in case it's a transient blip.
      setAiOffline(true);
    } finally {
      isProcessingRef.current = false;
    }
  }, []);

  // ------------------------------------------------------------------
  // MONITORING: Start / Stop
  // ------------------------------------------------------------------
  const startMonitoring = useCallback(() => {
    if (!cameraActive) {
      setErrorMessage("⚠️ Please start the camera before starting monitoring.");
      return;
    }
    setErrorMessage("");
    setMonitoring(true);

    intervalRef.current = setInterval(() => {
      captureAndDetect();
    }, CAPTURE_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive, captureAndDetect]);

  const stopMonitoring = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    isProcessingRef.current = false;
    setMonitoring(false);
    setAiOffline(false);
  }, []);

  // ------------------------------------------------------------------
  // CLEANUP ON UNMOUNT
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // DERIVED UI VALUES
  // ------------------------------------------------------------------
  const isAlert = monitoring && personCount > 0;
  const safetyStatus = isAlert ? "ALERT" : "SAFE";

  return (
    <div className="app">
      {/* ---------------- Header ---------------- */}
      <header className="header">
        <div className="header-title">
          <h1>🛡️ SafeLight</h1>
          <p>AI Safety Camera</p>
        </div>
        <div className={`camera-status ${cameraActive ? "active" : "offline"}`}>
          <span className="dot" />
          {cameraActive ? "Camera Active" : "Camera Offline"}
        </div>
      </header>

      <main className="main">
        {/* ---------------- Error / warning banners ---------------- */}
        {errorMessage && <div className="banner error-banner">{errorMessage}</div>}
        {aiOffline && (
          <div className="banner warning-banner">⚠️ AI service is unavailable.</div>
        )}

        {/* ---------------- Camera Preview ---------------- */}
        <div className="camera-container">
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
            autoPlay
          />
          <canvas ref={overlayCanvasRef} className="overlay-canvas" />
          {/* Hidden canvas used only for capturing frames to send to the AI service */}
          <canvas ref={captureCanvasRef} style={{ display: "none" }} />

          {!cameraActive && (
            <div className="camera-placeholder">
              <span>📷</span>
              <p>Camera is off</p>
            </div>
          )}

          {monitoring && (
            <div className={`detection-alert ${isAlert ? "danger" : "safe"}`}>
              {isAlert ? `🚨 PERSON DETECTED` : "SAFE"}
            </div>
          )}

          <div className="monitor-indicator">
            <span className="dot" />
            {monitoring ? "Monitoring" : "Idle"}
          </div>
        </div>

        {/* ---------------- Controls ---------------- */}
        <div className="controls">
          {!cameraActive ? (
            <button className="btn btn-primary" onClick={startCamera}>
              📷 Start Camera
            </button>
          ) : (
            <button className="btn btn-danger" onClick={stopCamera}>
              ⏹ Stop Camera
            </button>
          )}

          {!monitoring ? (
            <button
              className="btn btn-secondary"
              onClick={startMonitoring}
              disabled={!cameraActive}
            >
              ▶ Start Monitoring
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={stopMonitoring}>
              ⏸ Stop Monitoring
            </button>
          )}
        </div>

        {/* ---------------- Status Dashboard ---------------- */}
        <div className="dashboard">
          <div className="card">
            <div className="card-icon">📷</div>
            <div className="card-label">Camera</div>
            <div className={`card-value ${cameraActive ? "value-good" : "value-neutral"}`}>
              {cameraActive ? "ACTIVE" : "OFFLINE"}
            </div>
          </div>

          <div className="card">
            <div className="card-icon">🤖</div>
            <div className="card-label">AI Monitoring</div>
            <div className={`card-value ${monitoring ? "value-good" : "value-neutral"}`}>
              {monitoring ? "RUNNING" : "STOPPED"}
            </div>
          </div>

          <div className="card">
            <div className="card-icon">👤</div>
            <div className="card-label">People Detected</div>
            <div className="card-value">{personCount}</div>
          </div>

          <div className="card">
            <div className="card-icon">🛡️</div>
            <div className="card-label">Safety Status</div>
            <div className={`card-value ${isAlert ? "value-alert" : "value-good"}`}>
              {safetyStatus}
            </div>
          </div>
        </div>

        <p className="footnote">
          Device ID: {DEVICE_ID} &nbsp;|&nbsp; AI Service: {AI_SERVICE_URL}
        </p>
        <p className="footnote">
          <a href="/login" target="_blank" rel="noopener noreferrer">
            👮 Police Dashboard Login
          </a>
        </p>
      </main>
    </div>
  );
}
