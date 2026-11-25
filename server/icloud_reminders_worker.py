#!/usr/bin/env python3
"""Small stdin/stdout adapter around PyiCloudService.

Credentials are received over stdin and are never passed in process arguments.
The process stays alive so Apple's interactive 2FA challenge remains available
between authenticate and verify requests.
"""

from __future__ import annotations

import dataclasses
from contextlib import redirect_stdout
import datetime as dt
import enum
import importlib.metadata
import json
import logging
import os
import sys
from typing import Any

os.umask(0o077)
logging.disable(logging.CRITICAL)

try:
    from pyicloud import PyiCloudService
    from pyicloud.exceptions import PyiCloudFailedLoginException

    PYICLOUD_AVAILABLE = True
except Exception:
    PyiCloudService = None  # type: ignore[assignment,misc]
    PyiCloudFailedLoginException = Exception  # type: ignore[assignment,misc]
    PYICLOUD_AVAILABLE = False

api: Any = None
two_step_devices: list[dict[str, Any]] = []
two_step_device: dict[str, Any] | None = None
auth_mode: str | None = None


def respond(value: dict[str, Any]) -> None:
    protocol_output.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    protocol_output.flush()


def safe_error(exc: Exception) -> dict[str, str]:
    name = type(exc).__name__
    if isinstance(exc, PyiCloudFailedLoginException):
        return {"errorCode": "invalid_credentials", "error": "Apple rejected the Apple ID or password."}
    if "Connection" in name or "Timeout" in name:
        return {"errorCode": "apple_unreachable", "error": "Could not reach Apple iCloud."}
    if "AccountLocked" in name:
        return {"errorCode": "account_locked", "error": "Apple temporarily locked this account. Try again later."}
    if "AcceptTerms" in name:
        return {"errorCode": "terms_required", "error": "Apple requires updated iCloud terms to be accepted."}
    return {"errorCode": "icloud_request_failed", "error": "PyICloud could not complete the request."}


def object_fields(value: Any) -> list[str]:
    if dataclasses.is_dataclass(value):
        return [field.name for field in dataclasses.fields(value)]
    if hasattr(value, "model_fields"):
        return list(value.model_fields)
    if hasattr(value, "__dict__"):
        return [key for key in vars(value) if not key.startswith("_")]
    return []


def json_value(value: Any, depth: int = 0) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        if isinstance(value, str) and len(value) > 1200:
            return value[:1200] + "…"
        return value
    if depth >= 5:
        return f"<{type(value).__name__}>"
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, enum.Enum):
        return json_value(value.value, depth + 1)
    if isinstance(value, dict):
        return {
            str(key): json_value(item, depth + 1)
            for key, item in list(value.items())[:40]
            if not any(part in str(key).lower() for part in ("password", "cookie", "token", "authorization", "account", "owner", "dsid", "email"))
        }
    if isinstance(value, (list, tuple, set)):
        return [json_value(item, depth + 1) for item in list(value)[:20]]
    if dataclasses.is_dataclass(value):
        return json_value(dataclasses.asdict(value), depth + 1)
    if hasattr(value, "model_dump"):
        return json_value(value.model_dump(mode="json"), depth + 1)
    if hasattr(value, "__dict__"):
        return json_value(
            {key: item for key, item in vars(value).items() if not key.startswith("_")},
            depth + 1,
        )
    return str(value)[:300]


def authenticate(request: dict[str, Any]) -> dict[str, Any]:
    global api, auth_mode, two_step_devices, two_step_device
    if not PYICLOUD_AVAILABLE:
        return {"ok": False, "errorCode": "pyicloud_unavailable", "error": "PyICloud is not installed in this server runtime."}
    apple_id = str(request.get("appleId") or "").strip()
    password = str(request.get("password") or "")
    cookie_directory = str(request.get("cookieDirectory") or "")
    if not apple_id or not password or not cookie_directory:
        return {"ok": False, "errorCode": "credentials_missing", "error": "Enter and save the Apple ID and password first."}
    os.makedirs(cookie_directory, mode=0o700, exist_ok=True)
    os.chmod(cookie_directory, 0o700)
    api = None
    auth_mode = None
    two_step_devices = []
    two_step_device = None
    try:
        api = PyiCloudService(
            apple_id,
            password,
            cookie_directory=cookie_directory,
            with_family=False,
            refresh_interval=None,
        )
        if api.requires_2fa:
            auth_mode = "2fa"
            security_key_names = list(getattr(api, "security_key_names", []) or [])
            if security_key_names:
                return {
                    "ok": True,
                    "state": "security_key_required",
                    "securityKeyNames": [str(name)[:80] for name in security_key_names[:8]],
                }
            if not api.request_2fa_code():
                return {"ok": False, "errorCode": "verification_delivery_failed", "error": "Apple could not send a verification code."}
            return {"ok": True, "state": "verification_required"}
        if api.requires_2sa:
            auth_mode = "2sa"
            two_step_devices = list(api.trusted_devices or [])
            return {
                "ok": True,
                "state": "device_selection_required",
                "devices": [
                    {
                        "index": index,
                        "name": str(device.get("deviceName") or device.get("phoneNumber") or f"Device {index + 1}")[:100],
                    }
                    for index, device in enumerate(two_step_devices[:8])
                ],
            }
        return {"ok": True, "state": "authenticated"}
    except Exception as exc:
        api = None
        return {"ok": False, **safe_error(exc)}


def request_2sa_code(request: dict[str, Any]) -> dict[str, Any]:
    global two_step_device
    if api is None or auth_mode != "2sa":
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    try:
        index = int(request.get("deviceIndex", 0))
        if index < 0 or index >= len(two_step_devices):
            return {"ok": False, "errorCode": "invalid_device", "error": "Choose a listed verification device."}
        two_step_device = two_step_devices[index]
        if not api.send_verification_code(two_step_device):
            return {"ok": False, "errorCode": "verification_delivery_failed", "error": "Apple could not send a verification code."}
        return {"ok": True, "state": "verification_required"}
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def verify_code(request: dict[str, Any]) -> dict[str, Any]:
    if api is None or auth_mode not in ("2fa", "2sa"):
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    code = "".join(character for character in str(request.get("code") or "") if character.isdigit())
    if not code:
        return {"ok": False, "errorCode": "verification_code_required", "error": "Enter the verification code from Apple."}
    try:
        if auth_mode == "2fa":
            verified = api.validate_2fa_code(code)
        else:
            if two_step_device is None:
                return {"ok": False, "errorCode": "verification_device_required", "error": "Request a code from a verification device first."}
            verified = api.validate_verification_code(two_step_device, code)
        if not verified:
            return {"ok": False, "errorCode": "verification_code_invalid", "error": "Apple did not accept that verification code."}
        trusted = bool(getattr(api, "is_trusted_session", False))
        if not trusted and auth_mode == "2fa":
            trusted = bool(api.trust_session())
        return {"ok": True, "state": "authenticated" if trusted or auth_mode == "2sa" else "verified_untrusted"}
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def fetch_preview() -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    try:
        reminders_service = api.reminders
        lists = list(reminders_service.lists())
        previews = [
            {"title": str(getattr(reminder_list, "title", ""))}
            for reminder_list in lists[:30]
        ]
        first_sample = None
        if lists:
            reminder_list = lists[0]
            batch = reminders_service.list_reminders(
                reminder_list,
                include_completed=True,
                results_limit=5,
            )
            reminders = list(getattr(batch, "reminders", []) or [])
            previews[0]["reminderCountReturned"] = len(reminders)
            first_sample = {
                "listFields": object_fields(reminder_list),
                "list": json_value(reminder_list),
                "snapshotFields": object_fields(batch),
                "reminderFields": object_fields(reminders[0]) if reminders else [],
                "reminders": [json_value(reminder) for reminder in reminders[:5]],
            }
        return {
            "ok": True,
            "state": "fetched",
            "pyicloudVersion": importlib.metadata.version("pyicloud"),
            "listCount": len(lists),
            "lists": previews,
            "decodedAppleSample": first_sample,
        }
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def handle(request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action")
    if action == "ping":
        return {
            "ok": True,
            "available": PYICLOUD_AVAILABLE,
            "pyicloudVersion": importlib.metadata.version("pyicloud") if PYICLOUD_AVAILABLE else None,
        }
    if action == "reset":
        global api, auth_mode, two_step_devices, two_step_device
        api = None
        auth_mode = None
        two_step_devices = []
        two_step_device = None
        return {"ok": True, "state": "disconnected"}
    if action == "authenticate":
        return authenticate(request)
    if action == "request_2sa_code":
        return request_2sa_code(request)
    if action == "verify_code":
        return verify_code(request)
    if action == "fetch_preview":
        return fetch_preview()
    return {"ok": False, "errorCode": "unknown_action", "error": "Unknown PyICloud action."}


protocol_output = sys.stdout
for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request.get("requestId")
        with redirect_stdout(sys.stderr):
            result = handle(request if isinstance(request, dict) else {})
        respond({"requestId": request_id, **result})
    except Exception:
        respond({"requestId": None, "ok": False, "errorCode": "worker_error", "error": "PyICloud worker could not complete the request."})
