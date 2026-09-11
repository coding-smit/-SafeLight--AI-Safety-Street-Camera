"""
detector.py
-----------
Wraps an Ultralytics YOLO model and exposes a simple PersonDetector
class that only reports detections for the "person" class (COCO class
id 0), filtered by a confidence threshold.
"""

import numpy as np
from ultralytics import YOLO

# COCO dataset class id for "person"
PERSON_CLASS_ID = 0


class PersonDetector:
    """Runs YOLO inference on an image and returns only person detections."""

    def __init__(self, model_path: str = "yolo11n.pt", confidence_threshold: float = 0.5):
        """
        Args:
            model_path: Path or name of the YOLO model weights. If the
                weights are not already downloaded, Ultralytics will
                automatically download them on first use.
            confidence_threshold: Minimum confidence score (0-1) required
                for a detection to be counted.
        """
        self.confidence_threshold = confidence_threshold
        self.person_class_id = PERSON_CLASS_ID

        # Ultralytics automatically downloads the weights file if it's
        # not found locally (e.g. "yolo11n.pt").
        self.model = YOLO(model_path)

    def detect(self, image: np.ndarray) -> dict:
        """
        Run person detection on a single BGR image (as returned by
        cv2.imdecode / cv2.imread).

        Returns:
            {
                "person_count": int,
                "detections": [
                    {"class": "person", "confidence": 0.91, "bbox": [x1, y1, x2, y2]},
                    ...
                ]
            }
        """
        # verbose=False keeps the server logs clean since this runs
        # multiple times per second during monitoring.
        results = self.model(image, verbose=False)[0]

        detections = []

        if results.boxes is not None:
            for box in results.boxes:
                cls_id = int(box.cls[0])
                confidence = float(box.conf[0])

                # Only keep "person" detections above the confidence threshold.
                if cls_id != self.person_class_id:
                    continue
                if confidence < self.confidence_threshold:
                    continue

                x1, y1, x2, y2 = box.xyxy[0].tolist()
                detections.append({
                    "class": "person",
                    "confidence": round(confidence, 2),
                    "bbox": [int(x1), int(y1), int(x2), int(y2)]
                })

        return {
            "person_count": len(detections),
            "detections": detections
        }
