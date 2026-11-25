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
import hashlib
import importlib.metadata
import io
import json
import logging
import os
import sys
import time
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


def log_event(event: str, **fields: Any) -> None:
    entry = {"service": "pyicloud-reminders", "event": event, **fields}
    sys.stderr.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stderr.flush()


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


def reminders_list_key(reminder_list: Any) -> str:
    identity = [
        getattr(reminder_list, "scope", "private"),
        getattr(reminder_list, "zone_name", "Reminders"),
        getattr(reminder_list, "zone_owner", None),
        getattr(reminder_list, "id", ""),
    ]
    encoded = json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def reminders_list_summary(reminder_list: Any) -> dict[str, Any]:
    count = getattr(reminder_list, "count", None)
    return {
        "key": reminders_list_key(reminder_list),
        "title": str(getattr(reminder_list, "title", "")),
        "scope": str(getattr(reminder_list, "scope", "private")),
        "deleted": bool(getattr(reminder_list, "deleted", False)),
        "isGroup": bool(getattr(reminder_list, "is_group", False)),
        "count": count if isinstance(count, int) else None,
    }


def fetch_lists() -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    try:
        reminders_service = api.reminders
        lists = list(reminders_service.lists())
        return {
            "ok": True,
            "state": "authenticated",
            "pyicloudVersion": importlib.metadata.version("pyicloud"),
            "listCount": len(lists),
            "lists": [reminders_list_summary(reminder_list) for reminder_list in lists[:50]],
        }
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def fetch_preview(request: dict[str, Any]) -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    try:
        reminders_service = api.reminders
        lists = list(reminders_service.lists())
        selected_key = str(request.get("listKey") or "")
        reminder_list = next(
            (
                item
                for item in lists
                if not getattr(item, "deleted", False)
                and reminders_list_key(item) == selected_key
            ),
            None,
        )
        if reminder_list is None:
            return {
                "ok": False,
                "errorCode": "selected_list_not_found",
                "error": "Choose an active iCloud Reminders list, then load its preview again.",
            }
        batch = reminders_service.list_reminders(
            reminder_list,
            include_completed=True,
            results_limit=10,
        )
        reminders = list(getattr(batch, "reminders", []) or [])
        summary = reminders_list_summary(reminder_list)
        summary["reminderCountReturned"] = len(reminders)
        summary["reminders"] = [json_value(reminder) for reminder in reminders[:10]]
        return {
            "ok": True,
            "state": "fetched",
            "pyicloudVersion": importlib.metadata.version("pyicloud"),
            "listCount": len(lists),
            "lists": [summary],
            "decodedAppleSample": {
                "listFields": object_fields(reminder_list),
                "list": json_value(reminder_list),
                "snapshotFields": object_fields(batch),
                "snapshot": json_value(batch),
                "reminderFields": sorted(
                    {field for reminder in reminders for field in object_fields(reminder)}
                ),
                "reminders": [json_value(reminder) for reminder in reminders[:10]],
            },
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
    if action == "list_lists":
        return fetch_lists()
    if action == "request_2sa_code":
        return request_2sa_code(request)
    if action == "verify_code":
        return verify_code(request)
    if action == "fetch_preview":
        return fetch_preview(request)
    return {"ok": False, "errorCode": "unknown_action", "error": "Unknown PyICloud action."}


protocol_output = sys.stdout
log_event(
    "worker_started",
    pyicloud_available=PYICLOUD_AVAILABLE,
    pyicloud_version=importlib.metadata.version("pyicloud") if PYICLOUD_AVAILABLE else None,
)
for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request.get("requestId")
        action = str(request.get("action") or "unknown")
        started_at = time.monotonic()
        log_event("request_started", request_id=request_id, action=action)
        with redirect_stdout(io.StringIO()):
            result = handle(request if isinstance(request, dict) else {})
        log_event(
            "request_finished",
            request_id=request_id,
            action=action,
            ok=bool(result.get("ok")),
            state=result.get("state"),
            error_code=result.get("errorCode"),
            duration_ms=round((time.monotonic() - started_at) * 1000),
            list_count=result.get("listCount"),
            reminder_counts=[
                item.get("reminderCountReturned")
                for item in result.get("lists", [])
                if isinstance(item, dict) and "reminderCountReturned" in item
            ],
        )
        respond({"requestId": request_id, **result})
    except Exception:
        log_event("request_failed", error_code="worker_error")
        respond({"requestId": None, "ok": False, "errorCode": "worker_error", "error": "PyICloud worker could not complete the request."})
