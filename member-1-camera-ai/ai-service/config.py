"""
config.py
---------
Two simple in-memory "databases" for the MVP:

1. POLICE_OFFICERS - who is allowed to log into the Police Dashboard.
2. DEVICE_LOCATIONS - the fixed, registered installation location of
   each SafeLight camera device. Since these cameras are meant to be
   mounted in place (like a streetlight camera), their location does
   NOT come from live GPS - it's set once here, when the device is
   installed/registered, and stays stable.

------------------------------------------------------------------
IMPORTANT - THIS IS A DEMO-LEVEL SETUP, NOT PRODUCTION SECURITY:
- Passwords below are hashed with SHA-256 purely so the plaintext
  isn't visible in this file. SHA-256 alone is NOT considered secure
  for password storage in a real system - use bcrypt/argon2 (e.g. via
  the "passlib" library) before this ever handles real accounts.
- SECRET_KEY must be moved to an environment variable and rotated
  before any real deployment - anyone who has this value can forge
  valid login tokens.
- Officer accounts and device locations should live in a real
  database (SQLite/Postgres) instead of this hardcoded file once
  this grows past a hackathon demo.
------------------------------------------------------------------
"""

import hashlib

# Secret used to sign login tokens (JWT). Change this to a long random
# string via an environment variable before any real deployment.
SECRET_KEY = "safelight-demo-secret-change-me"

# How long a police login session stays valid, in hours.
TOKEN_EXPIRY_HOURS = 8


def _hash_password(plain_password: str) -> str:
    return hashlib.sha256(plain_password.encode("utf-8")).hexdigest()


# Demo police accounts: username -> hashed password.
# Default login for testing: username "officer1", password "safelight123"
POLICE_OFFICERS = {
    "officer1": _hash_password("safelight123"),
}


def verify_officer_credentials(username: str, password: str) -> bool:
    stored_hash = POLICE_OFFICERS.get(username)
    if not stored_hash:
        return False
    return stored_hash == _hash_password(password)


# Fixed, registered locations for each camera device. Add a new entry
# here whenever a new SafeLight camera is installed somewhere.
# Coordinates below are just placeholder examples - replace with the
# real installation coordinates for each device.
DEVICE_LOCATIONS = {
    "PHONE-001": {
        "lat": 21.5222,
        "lng": 70.4579,
        "address": "Main Street Junction, Junagadh, Gujarat"
    },
}


def get_device_location(device_id: str):
    """Returns the fixed {lat, lng, address} for a registered device,
    or None if the device_id hasn't been registered yet."""
    return DEVICE_LOCATIONS.get(device_id)
