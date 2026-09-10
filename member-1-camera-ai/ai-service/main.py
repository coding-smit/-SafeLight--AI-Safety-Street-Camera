"""
main.py
-------
FastAPI application for the SafeLight AI Service.

Exposes:
    GET  /health         -> service health check
    POST /detect         -> runs YOLO person detection on an uploaded image
    POST /auth/login      -> police officer login, returns a JWT token
    WS   /ws/dashboard   -> Police Dashboard clients connect here (requires
                            a valid token) to receive live snapshots,
                            alerts, and each camera's fixed location.
"""

import base64
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import cv2
import jwt
import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from detector import PersonDetector
from config import (
    SECRET_KEY,
    TOKEN_EXPIRY_HOURS,
    verify_officer_credentials,
    get_device_location,
)

app = FastAPI(title="SafeLight AI Service")

# Allow the React frontend (running on a different origin/port, and
# possibly a different device on the LAN) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the YOLO model once at startup. If "yolo11n.pt" isn't already
# downloaded, Ultralytics will fetch it automatically the first time
# this line runs.
detector = PersonDetector(model_path="yolo11n.pt", confidence_threshold=0.5)

# Number of people that triggers a police alert (not just "person detected").
ALERT_PERSON_THRESHOLD = 2


# ------------------------------------------------------------------
# Authentication helpers (police officer login -> JWT token)
# ------------------------------------------------------------------
def create_token(username: str) -> str:
    payload = {
        "sub": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRY_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def verify_token(token: str) -> Optional[str]:
    """Returns the username if the token is valid, otherwise None."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


@app.post("/auth/login")
async def login(username: str = Form(...), password: str = Form(...)):
    """Police officer login. Returns a JWT token used to open the
    dashboard WebSocket connection."""
    if not verify_officer_credentials(username, password):
        return JSONResponse(
            status_code=401,
            content={"success": False, "message": "Invalid username or password"}
        )

    token = create_token(username)
    return {"success": True, "token": token, "username": username}


# ------------------------------------------------------------------
# WebSocket connection manager for the Police Dashboard
# ------------------------------------------------------------------
class ConnectionManager:
    """Keeps track of every connected (and authenticated) Police
    Dashboard browser tab and broadcasts each new detection result to
    all of them."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for dead in dead_connections:
            self.disconnect(dead)


manager = ConnectionManager()


@app.get("/health")
def health():
    """Simple health check endpoint."""
    return {"status": "ok", "service": "safelight-ai"}


@app.websocket("/ws/dashboard")
async def dashboard_socket(websocket: WebSocket, token: Optional[str] = None):
    """
    Police Dashboard clients connect here, e.g.:
        ws://localhost:8000/ws/dashboard?token=<JWT from /auth/login>

    The connection is rejected unless a valid, unexpired token is
    provided - only logged-in police officers can watch the live feed.
    """
    username = verify_token(token) if token else None

    if not username:
        # Reject before accepting - close with a custom code so the
        # frontend can tell "not logged in" apart from a network drop.
        await websocket.close(code=4401)
        return

    await manager.connect(websocket)
    try:
        while True:
            # We don't expect the dashboard to send data, but we must
            # await something to detect disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


def _draw_annotations(image: np.ndarray, detections: list) -> np.ndarray:
    """Draws bounding boxes + labels onto a copy of the image, for the
    snapshot that gets broadcast to the Police Dashboard."""
    annotated = image.copy()
    for det in detections:
        x1, y1, x2, y2 = det["bbox"]
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
        label = f'Person {int(det["confidence"] * 100)}%'
        text_y = max(y1 - 10, 20)
        cv2.putText(
            annotated, label, (x1, text_y),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2
        )
    return annotated


@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    device_id: str = Form("PHONE-001"),
):
    """
    Accepts an uploaded image (multipart/form-data, field name "file")
    plus a device_id, runs YOLO person detection, broadcasts the
    annotated snapshot + alert status + the device's registered fixed
    location to any connected (authenticated) Police Dashboard
    clients, and returns the detection result to the camera frontend.
    """
    try:
        contents = await file.read()

        if not contents:
            return JSONResponse(
                status_code=400,
                content={"success": False, "message": "Invalid image"}
            )

        # Decode the uploaded bytes into an OpenCV (BGR) image.
        np_arr = np.frombuffer(contents, np.uint8)
        image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if image is None:
            return JSONResponse(
                status_code=400,
                content={"success": False, "message": "Invalid image"}
            )

        result = detector.detect(image)
        person_count = result["person_count"]
        detections = result["detections"]

        # Build an annotated snapshot (with boxes drawn in) and encode
        # it as a small JPEG for the Police Dashboard to display live.
        annotated = _draw_annotations(image, detections)
        ok, buffer = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        image_base64 = base64.b64encode(buffer).decode("utf-8") if ok else None

        is_alert = person_count >= ALERT_PERSON_THRESHOLD

        # Look up this device's FIXED, registered installation location
        # (not live GPS) - stable street-camera style location.
        location = get_device_location(device_id)

        # Push the live update to every connected Police Dashboard tab.
        await manager.broadcast({
            "device_id": device_id,
            "person_count": person_count,
            "detections": detections,
            "image_base64": image_base64,
            "location": location,  # {lat, lng, address} or None if unregistered
            "alert": is_alert,
            "alert_threshold": ALERT_PERSON_THRESHOLD,
            "timestamp": time.time(),
        })

        return {
            "success": True,
            "person_count": person_count,
            "detections": detections
        }

    except Exception:
        # Catch-all so a bad/corrupt frame never crashes the service.
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Invalid image"}
        )
