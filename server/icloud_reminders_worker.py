#!/usr/bin/env python3
"""Small stdin/stdout adapter around PyiCloudService.

Credentials are received over stdin and are never passed in process arguments.
The process stays alive so Apple's interactive 2FA challenge remains available
between authenticate and verify requests.
"""

from __future__ import annotations

import base64
import dataclasses
from contextlib import contextmanager, redirect_stdout
import datetime as dt
import enum
import hashlib
import importlib.metadata
import io
import json
import logging
import os
import plistlib
import sys
import time
from typing import Any
from urllib.parse import urlsplit

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


_SECTION_FIELD_PARTS = ("section", "membership", "group")
_SECTION_NAME_FIELDS = {
    "name",
    "title",
    "displayname",
    "sectionname",
    "titledocument",
    "namedocument",
}
_MAX_DIAGNOSTIC_RECORDS = 30
_MAX_DIAGNOSTIC_FIELDS = 80
_MAX_SECTION_CANDIDATES = 8
_MAX_SECTION_LOG_TEXT = 32_000
_SECTION_SENSITIVE_KEY_PARTS = (
    "url",
    "token",
    "cookie",
    "password",
    "authorization",
    "signature",
    "session",
    "wrappingkey",
    "secret",
)
_MAX_SECTION_ASSET_BYTES = 1_000_000


def respond(value: dict[str, Any]) -> None:
    protocol_output.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    protocol_output.flush()


def log_event(event: str, **fields: Any) -> None:
    entry = {"service": "pyicloud-reminders", "event": event, **fields}
    sys.stderr.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stderr.flush()


def _short_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def _safe_section_value(value: Any, depth: int = 0) -> Any:
    """Keep section diagnostics useful without logging reminder content."""
    if depth >= 3:
        return "<nested>"
    if isinstance(value, dict):
        # CloudKit values wrap their payload as {"type": ..., "value": ...}.
        if "value" in value and "type" in value:
            return _safe_section_value(value.get("value"), depth + 1)
        nested: dict[str, Any] = {}
        for key, item in list(value.items())[:12]:
            normalized_key = str(key).lower()
            if any(part in normalized_key for part in _SECTION_FIELD_PARTS) or normalized_key in _SECTION_NAME_FIELDS:
                nested[str(key)[:80]] = _safe_section_value(item, depth + 1)
        return nested or "<structured section value>"
    if isinstance(value, (list, tuple)):
        return [_safe_section_value(item, depth + 1) for item in list(value)[:10]]
    if isinstance(value, str):
        return value[:240]
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return f"<{type(value).__name__}>"


def _download_section_asset(raw_client: Any, asset: Any) -> dict[str, Any]:
    """Download and safely summarize a CloudKit section metadata asset."""
    if not isinstance(asset, dict):
        return {"state": "unavailable", "reason": "asset_metadata_missing"}
    url = asset.get("downloadURL")
    if not isinstance(url, str):
        return {"state": "unavailable", "reason": "download_url_missing"}
    try:
        parsed_url = urlsplit(url)
        hostname = (parsed_url.hostname or "").lower()
    except ValueError:
        return {"state": "skipped", "reason": "invalid_download_url"}
    if parsed_url.scheme != "https" or not (hostname == "icloud-content.com" or hostname.endswith(".icloud-content.com")):
        return {"state": "skipped", "reason": "untrusted_download_host"}
    declared_size = asset.get("size")
    if isinstance(declared_size, int) and declared_size > _MAX_SECTION_ASSET_BYTES:
        return {"state": "skipped", "reason": "asset_too_large", "declaredBytes": declared_size}
    downloader = getattr(raw_client, "download_asset_stream", None)
    if not callable(downloader):
        return {"state": "unavailable", "reason": "asset_download_not_supported"}

    chunks: list[bytes] = []
    total_bytes = 0
    try:
        for chunk in downloader(url, chunk_size=65_536):
            if not isinstance(chunk, bytes):
                continue
            total_bytes += len(chunk)
            if total_bytes > _MAX_SECTION_ASSET_BYTES:
                return {"state": "skipped", "reason": "asset_too_large", "downloadedBytes": total_bytes}
            chunks.append(chunk)
    except Exception as exc:
        return {"state": "download_failed", "errorType": type(exc).__name__}

    payload = b"".join(chunks)
    summary: dict[str, Any] = {
        "state": "downloaded",
        "byteCount": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }
    try:
        decoded_json = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        decoded_json = None
    if decoded_json is not None:
        summary["decodedJson"] = _full_section_value(decoded_json)
        return summary
    try:
        decoded_plist = plistlib.loads(payload)
    except Exception:
        decoded_plist = None
    if decoded_plist is not None:
        summary["decodedPlist"] = _full_section_value(decoded_plist)
        return summary
    try:
        decoded_text = payload.decode("utf-8")
    except UnicodeDecodeError:
        summary["contentType"] = "binary"
        summary["prefixHex"] = payload[:32].hex()
    else:
        summary["contentType"] = "text"
        summary["decodedText"] = decoded_text[:_MAX_SECTION_LOG_TEXT]
        summary["truncated"] = len(decoded_text) > _MAX_SECTION_LOG_TEXT
    return summary


def _full_section_value(
    value: Any,
    depth: int = 0,
    asset_downloader: Any = None,
) -> Any:
    """Preserve section payload details while removing credentials and URLs."""
    if depth >= 10:
        return "<maximum-depth>"
    if isinstance(value, dict):
        if "value" in value and "type" in value:
            wrapped_type = str(value.get("type") or "")
            wrapped_value = value.get("value")
            if wrapped_type.upper() in {"ASSET", "ASSETID"} and isinstance(wrapped_value, dict):
                result = {
                    "type": wrapped_type,
                    "value": _full_section_value(wrapped_value, depth + 1),
                }
                if callable(asset_downloader):
                    result["downloadedAsset"] = asset_downloader(wrapped_value)
                return result
            if wrapped_type.upper() in {"BYTES", "BYTES_STRING"} and isinstance(wrapped_value, str):
                try:
                    decoded = base64.b64decode(wrapped_value, validate=True)
                    decoded_json = json.loads(decoded.decode("utf-8"))
                    return {
                        "type": wrapped_type,
                        "decodedJson": _full_section_value(decoded_json, depth + 1),
                    }
                except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
                    return {
                        "type": wrapped_type,
                        "encodedLength": len(wrapped_value),
                        "value": wrapped_value[:_MAX_SECTION_LOG_TEXT],
                        "truncated": len(wrapped_value) > _MAX_SECTION_LOG_TEXT,
                    }
        nested: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            normalized_key = key_text.lower()
            if any(part in normalized_key for part in _SECTION_SENSITIVE_KEY_PARTS):
                nested[key_text[:100]] = "<redacted>"
            else:
                nested[key_text[:100]] = _full_section_value(item, depth + 1)
        return nested
    if isinstance(value, (list, tuple)):
        return [_full_section_value(item, depth + 1) for item in value]
    if isinstance(value, str):
        return value[:_MAX_SECTION_LOG_TEXT]
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return f"<{type(value).__name__}>"


def _section_candidate_value(
    record_type: str,
    field_name: str,
    value: Any,
    asset_downloader: Any = None,
) -> Any:
    """Decode section title documents when the wire record identifies one."""
    normalized_name = field_name.lower()
    if "section" in record_type.lower() and normalized_name in {"titledocument", "namedocument"}:
        wrapped_value = value.get("value") if isinstance(value, dict) else value
        try:
            from pyicloud.services.reminders._protocol import _decode_crdt_document

            decoded = _decode_crdt_document(wrapped_value)
            return str(decoded)[:_MAX_SECTION_LOG_TEXT]
        except Exception:
            return "<encoded section name; decode unavailable>"
    if normalized_name in {
        "membershipsofremindersinsectionsasdata",
        "sectionidsorderingasdata",
    }:
        return _full_section_value(value, asset_downloader=asset_downloader)
    return _safe_section_value(value)


def _cloudkit_response_records(response: Any) -> list[dict[str, Any]]:
    if not isinstance(response, dict):
        return []
    records = response.get("records")
    if isinstance(records, list):
        return [record for record in records if isinstance(record, dict)]
    records = []
    zones = response.get("zones")
    if isinstance(zones, list):
        for zone in zones:
            if isinstance(zone, dict) and isinstance(zone.get("records"), list):
                records.extend(record for record in zone["records"] if isinstance(record, dict))
    return records


def _cloudkit_record_summaries(
    response: Any,
    selected_record_id_hash: str | None = None,
    raw_client: Any = None,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    """Summarize raw CloudKit records, exposing section candidates only."""
    records = _cloudkit_response_records(response)

    type_counts: dict[str, int] = {}
    summaries: list[dict[str, Any]] = []
    for record in records:
        record_type = str(record.get("recordType") or "<unknown>")[:100]
        type_counts[record_type] = type_counts.get(record_type, 0) + 1
        if len(summaries) >= _MAX_DIAGNOSTIC_RECORDS:
            continue

        fields = record.get("fields") if isinstance(record.get("fields"), dict) else {}
        plugin_fields = record.get("pluginFields") if isinstance(record.get("pluginFields"), dict) else {}
        field_names = sorted({str(key)[:100] for key in fields} | {f"pluginFields.{str(key)[:90]}" for key in plugin_fields})
        record_id_hash = _short_hash(str(record.get("recordName") or "<unnamed>"))
        summary: dict[str, Any] = {
            "recordType": record_type,
            "recordIdHash": record_id_hash,
            "fieldNames": field_names[:_MAX_DIAGNOSTIC_FIELDS],
        }
        matches_selected_list = (
            selected_record_id_hash is not None
            and record_type.lower() == "list"
            and record_id_hash == selected_record_id_hash
        )
        if selected_record_id_hash is not None and record_type.lower() == "list":
            summary["matchesSelectedList"] = matches_selected_list

        section_record = "section" in record_type.lower()
        candidates: dict[str, Any] = {}
        for source_name, source_fields in (("fields", fields), ("pluginFields", plugin_fields)):
            for field_name, value in source_fields.items():
                normalized_name = str(field_name).lower()
                is_candidate = any(part in normalized_name for part in _SECTION_FIELD_PARTS)
                is_section_name = section_record and normalized_name in _SECTION_NAME_FIELDS
                if not (is_candidate or is_section_name):
                    continue
                candidates[f"{source_name}.{str(field_name)[:80]}"] = _section_candidate_value(
                    record_type,
                    normalized_name,
                    value,
                    asset_downloader=(
                        lambda asset, _raw_client=raw_client: _download_section_asset(_raw_client, asset)
                    ) if matches_selected_list and raw_client is not None else None,
                )
                if len(candidates) >= _MAX_SECTION_CANDIDATES:
                    break
            if len(candidates) >= _MAX_SECTION_CANDIDATES:
                break
        if candidates:
            summary["sectionCandidates"] = candidates
        summaries.append(summary)

    ordered_types = [
        {"recordType": name, "count": count}
        for name, count in sorted(type_counts.items())
    ]
    return len(records), ordered_types, summaries


def _log_selected_section_assets(
    selected_list_ref: dict[str, Any],
    list_key: str,
    request_id: str,
    selected_list_id: str,
) -> None:
    selected_record_id_hash = _short_hash(selected_list_id)
    captured = selected_list_ref.get("section_records", {}).get(selected_record_id_hash)
    if not isinstance(captured, dict):
        return
    record = captured.get("record")
    raw_client = captured.get("raw_client")
    if not isinstance(record, dict):
        return
    record_count, record_type_counts, records = _cloudkit_record_summaries(
        {"records": [record]},
        selected_record_id_hash=selected_record_id_hash,
        raw_client=raw_client,
    )
    log_event(
        "cloudkit_response_inspected",
        scope=captured.get("scope", "private"),
        operation=captured.get("operation", "changes/zone"),
        diagnostic_phase="selected_section_asset_fetch",
        list_key=list_key,
        selected_record_id_hash=selected_record_id_hash,
        request_id=request_id,
        record_count=record_count,
        record_type_counts=record_type_counts,
        records=records,
        records_truncated=record_count > len(records),
    )


@contextmanager
def inspect_cloudkit_responses(
    reminders_service: Any,
    list_key: str,
    request_id: str,
    selected_list_ref: dict[str, Any] | None = None,
):
    """Log safe CloudKit response structure before PyICloud maps it to models."""
    patched: list[tuple[Any, Any]] = []
    for scope, raw_name in (("private", "_raw"), ("shared", "_shared_raw")):
        raw_client = getattr(reminders_service, raw_name, None)
        cloudkit_client = getattr(raw_client, "_client", None)
        http = getattr(cloudkit_client, "_http", None)
        original_post = getattr(http, "post", None)
        if not callable(original_post):
            continue

        def inspected_post(
            path: str,
            payload: Any,
            *args: Any,
            _original=original_post,
            _scope=scope,
            _raw_client=raw_client,
            **kwargs: Any,
        ):
            response = _original(path, payload, *args, **kwargs)
            operation = str(path).strip("/")
            if operation not in {"records/query", "records/lookup", "changes/zone"}:
                return response
            if selected_list_ref is not None:
                section_records = selected_list_ref.setdefault("section_records", {})
                for raw_record in _cloudkit_response_records(response):
                    if str(raw_record.get("recordType") or "").lower() != "list":
                        continue
                    raw_fields = raw_record.get("fields")
                    if not isinstance(raw_fields, dict):
                        continue
                    if not any(
                        str(name).lower() in {
                            "membershipsofremindersinsectionsasdata",
                            "sectionidsorderingasdata",
                        }
                        for name in raw_fields
                    ):
                        continue
                    record_name = str(raw_record.get("recordName") or "")
                    if record_name:
                        section_records[_short_hash(record_name)] = {
                            "scope": _scope,
                            "operation": operation,
                            "record": raw_record,
                            "raw_client": _raw_client,
                        }
            selected_list_id = str(selected_list_ref.get("id") or "") if selected_list_ref else ""
            selected_record_id_hash = _short_hash(selected_list_id) if selected_list_id else None
            record_count, record_type_counts, records = _cloudkit_record_summaries(
                response,
                selected_record_id_hash=selected_record_id_hash,
                raw_client=_raw_client,
            )
            log_event(
                "cloudkit_response_inspected",
                scope=_scope,
                operation=operation,
                list_key=list_key,
                selected_record_id_hash=selected_record_id_hash,
                request_id=request_id,
                record_count=record_count,
                record_type_counts=record_type_counts,
                records=records,
                records_truncated=record_count > len(records),
            )
            return response

        http.post = inspected_post
        patched.append((http, original_post))

    if not patched:
        log_event("cloudkit_diagnostic_unavailable", list_key=list_key)
    try:
        yield
    finally:
        for http, original_post in patched:
            http.post = original_post


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
        selected_key = str(request.get("listKey") or "")
        selected_list_ref: dict[str, Any] = {}
        with inspect_cloudkit_responses(
            reminders_service,
            selected_key,
            str(request.get("requestId") or "")[:100],
            selected_list_ref,
        ):
            lists = list(reminders_service.lists())
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
            selected_list_ref["id"] = str(getattr(reminder_list, "id", ""))
            _log_selected_section_assets(
                selected_list_ref,
                selected_key,
                str(request.get("requestId") or "")[:100],
                selected_list_ref["id"],
            )
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
