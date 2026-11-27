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
import zlib
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
_REMINDER_LIST_CACHE: dict[str, dict[str, Any]] = {}
_REMINDER_AVAILABLE_LISTS: dict[str, Any] = {}
_REMINDER_LIST_CATALOG: dict[str, Any] | None = None
_REMINDER_LIST_CATALOG_DIRTY = True
_REMINDER_SYNC_CURSOR: str | None = None
_REMINDER_REVISION_SEQUENCE = time.time_ns() // 1_000


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


def _section_asset_cache_key(asset: Any) -> str | None:
    if not isinstance(asset, dict):
        return None
    for field_name in ("fileChecksum", "referenceChecksum"):
        value = asset.get(field_name)
        if isinstance(value, str) and value:
            return f"{field_name}:{value}"
    url = asset.get("downloadURL")
    return f"url:{_short_hash(url)}" if isinstance(url, str) and url else None


def _section_asset_download_url(asset: Any) -> str | None:
    """Resolve CloudKit's filename placeholder before requesting an asset."""
    if not isinstance(asset, dict):
        return None
    url = asset.get("downloadURL")
    if not isinstance(url, str):
        return None
    return url.replace("${f}", "file")


def _summarize_section_asset_payload(payload: bytes) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "state": "downloaded",
        "byteCount": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }
    try:
        decoded_json = _decode_section_asset_json(payload)
    except SectionAssetDecodeError:
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


def _download_section_asset(
    raw_client: Any,
    asset: Any,
    payload_cache: dict[str, bytes] | None = None,
) -> dict[str, Any]:
    """Download and safely summarize a CloudKit section metadata asset."""
    if not isinstance(asset, dict):
        return {"state": "unavailable", "reason": "asset_metadata_missing"}
    url = _section_asset_download_url(asset)
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
    cache_key = _section_asset_cache_key(asset)
    payload = payload_cache.get(cache_key) if payload_cache is not None and cache_key else None
    if not isinstance(payload, bytes):
        asset_client = getattr(raw_client, "_client", None)
        downloader = getattr(asset_client, "download_asset_stream", None)
        if not callable(downloader):
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
        if payload_cache is not None and cache_key:
            payload_cache[cache_key] = payload
    return _summarize_section_asset_payload(payload)


def _download_section_asset_bytes(
    raw_client: Any,
    asset: Any,
    payload_cache: dict[str, bytes] | None = None,
) -> bytes:
    """Fetch a section asset for a read/modify/write operation."""
    if not isinstance(asset, dict):
        raise ValueError("The section membership asset is missing.")
    url = _section_asset_download_url(asset)
    if not isinstance(url, str):
        raise ValueError("The section membership asset URL is missing.")
    parsed_url = urlsplit(url)
    hostname = (parsed_url.hostname or "").lower()
    if parsed_url.scheme != "https" or not (
        hostname == "icloud-content.com" or hostname.endswith(".icloud-content.com")
    ):
        raise ValueError("Apple returned an unsupported section asset URL.")
    declared_size = asset.get("size")
    if isinstance(declared_size, int) and declared_size > _MAX_SECTION_ASSET_BYTES:
        raise ValueError("The section membership asset is too large.")
    cache_key = _section_asset_cache_key(asset)
    cached_payload = payload_cache.get(cache_key) if payload_cache is not None and cache_key else None
    if isinstance(cached_payload, bytes):
        return cached_payload
    cloudkit_client = getattr(raw_client, "_client", None)
    downloader = getattr(cloudkit_client, "download_asset_stream", None)
    if callable(downloader):
        chunks: list[bytes] = []
        total_bytes = 0
        for chunk in downloader(url, chunk_size=65_536):
            if not isinstance(chunk, bytes):
                continue
            total_bytes += len(chunk)
            if total_bytes > _MAX_SECTION_ASSET_BYTES:
                raise ValueError("The section membership asset is too large.")
            chunks.append(chunk)
        payload = b"".join(chunks)
    else:
        downloader = getattr(raw_client, "download_asset_bytes", None)
        if not callable(downloader):
            raise RuntimeError("This PyICloud version cannot download section assets.")
        payload = downloader(url)
        if not isinstance(payload, bytes) or len(payload) > _MAX_SECTION_ASSET_BYTES:
            raise ValueError("The section membership asset is too large or invalid.")
    if payload_cache is not None and cache_key:
        payload_cache[cache_key] = payload
    return payload


class SectionMutationError(RuntimeError):
    """A section-write failure with safe diagnostic fields for operator logs."""

    def __init__(
        self,
        stage: str,
        *,
        apple_error_code: str | None = None,
        http_status: int | None = None,
        failure_detail: str | None = None,
        message: str = "iCloud could not save the section change. Refresh the list and try again.",
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.apple_error_code = _safe_cloudkit_error_code(apple_error_code)
        self.http_status = http_status if isinstance(http_status, int) and 100 <= http_status <= 599 else None
        self.failure_detail = _safe_cloudkit_error_code(failure_detail)


def _safe_cloudkit_error_code(value: Any) -> str | None:
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        return None
    code = str(value)
    if not code or len(code) > 64 or not all(character.isalnum() or character in "_.-" for character in code):
        return None
    return code


def _section_mutation_error(exc: Exception, stage: str) -> SectionMutationError:
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if status is None:
        status = getattr(exc, "status_code", None)
    code = getattr(exc, "code", None)
    return SectionMutationError(
        stage,
        apple_error_code=_safe_cloudkit_error_code(code),
        http_status=status,
        failure_detail=getattr(exc, "diagnostic_code", None),
    )


def _section_mutation_failure(
    exc: SectionMutationError,
    *,
    reminder_id: str | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "errorCode": "icloud_section_update_failed",
        "error": str(exc),
        "failureStage": exc.stage,
    }
    if exc.apple_error_code:
        result["appleErrorCode"] = exc.apple_error_code
    if exc.http_status:
        result["httpStatus"] = exc.http_status
    if exc.failure_detail:
        result["failureDetail"] = exc.failure_detail
    if reminder_id:
        result["partial"] = True
        result["reminderId"] = reminder_id
        result["error"] = "The reminder was created, but iCloud could not move it into the selected section. Check the list before retrying."
    return result


class SectionAssetDecodeError(ValueError):
    """A safe section-asset decoding failure code."""

    def __init__(self, detail: str) -> None:
        super().__init__("Apple's section membership asset has an unsupported format.")
        self.diagnostic_code = detail


def _section_asset_payload_candidates(payload: bytes) -> list[bytes]:
    """Return the plain asset plus bounded zlib, gzip, and raw-deflate variants."""
    if not payload:
        raise SectionAssetDecodeError("empty_asset")
    candidates = [payload]
    for window_bits in (zlib.MAX_WBITS, zlib.MAX_WBITS | 16, -zlib.MAX_WBITS):
        try:
            decompressor = zlib.decompressobj(window_bits)
            decoded = decompressor.decompress(payload, _MAX_SECTION_ASSET_BYTES + 1)
            if len(decoded) > _MAX_SECTION_ASSET_BYTES or decompressor.unconsumed_tail:
                raise SectionAssetDecodeError("decompressed_asset_too_large")
            decoded += decompressor.flush(_MAX_SECTION_ASSET_BYTES + 1 - len(decoded))
            if len(decoded) <= _MAX_SECTION_ASSET_BYTES:
                candidates.append(decoded)
        except zlib.error:
            continue
    return candidates


def _decode_section_asset_json(payload: bytes) -> Any:
    """Decode JSON assets, including bounded compressed payloads."""
    candidates = _section_asset_payload_candidates(payload)
    last_detail = "invalid_json"
    for candidate in candidates:
        try:
            document = json.loads(candidate.decode("utf-8-sig"))
        except UnicodeDecodeError:
            last_detail = "invalid_utf8"
            continue
        except json.JSONDecodeError:
            continue
        return document
    raise SectionAssetDecodeError(last_detail)


def _decode_section_memberships(payload: bytes) -> dict[str, Any]:
    """Decode section memberships from JSON or property-list CloudKit assets."""
    try:
        document = _decode_section_asset_json(payload)
    except SectionAssetDecodeError as exc:
        schema_error = exc
    else:
        if isinstance(document, dict) and isinstance(document.get("memberships"), list):
            return document
        schema_error = SectionAssetDecodeError("unsupported_membership_schema")

    for candidate in _section_asset_payload_candidates(payload):
        try:
            document = plistlib.loads(candidate)
        except Exception:
            continue
        if isinstance(document, dict) and isinstance(document.get("memberships"), list):
            return document
        schema_error = SectionAssetDecodeError("unsupported_membership_schema")

    raise schema_error


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


def _section_asset_fingerprint(record: Any) -> str:
    fields = record.get("fields") if isinstance(record, dict) else None
    if not isinstance(fields, dict):
        return ""
    relevant: dict[str, Any] = {}
    for field_name in (
        "MembershipsOfRemindersInSectionsChecksum",
        "MembershipsOfRemindersInSectionsAsData",
        "SectionIDsOrderingAsData",
    ):
        value = fields.get(field_name)
        if isinstance(value, dict) and "value" in value:
            value = value.get("value")
        if field_name.endswith("AsData") and isinstance(value, dict):
            value = {
                key: value.get(key)
                for key in ("fileChecksum", "referenceChecksum", "size")
                if value.get(key) is not None
            }
        relevant[field_name] = value
    encoded = json.dumps(relevant, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _section_ids_from_summaries(records: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """Collect section IDs from membership and ordering assets."""
    ordered_ids: list[str] = []
    membership_ids: list[str] = []
    for record in records:
        candidates = record.get("sectionCandidates")
        if not isinstance(candidates, dict):
            continue
        memberships = candidates.get("fields.MembershipsOfRemindersInSectionsAsData")
        memberships = memberships.get("downloadedAsset", {}).get("decodedJson", {}) if isinstance(memberships, dict) else {}
        if isinstance(memberships, dict) and isinstance(memberships.get("memberships"), list):
            for membership in memberships["memberships"]:
                if isinstance(membership, dict) and isinstance(membership.get("groupID"), str):
                    membership_ids.append(membership["groupID"])

        ordering = candidates.get("fields.SectionIDsOrderingAsData")
        ordering = ordering.get("downloadedAsset", {}).get("decodedJson", {}) if isinstance(ordering, dict) else {}
        if isinstance(ordering, dict) and isinstance(ordering.get("orderedIdentifiers"), list):
            ordered_ids.extend(
                identifier for identifier in ordering["orderedIdentifiers"] if isinstance(identifier, str)
            )
    ordered_ids = list(dict.fromkeys(ordered_ids))
    all_ids = list(dict.fromkeys([*ordered_ids, *membership_ids]))
    return all_ids, ordered_ids


def _section_memberships_from_summaries(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Map reminder IDs to their most recently recorded section membership."""
    memberships_by_reminder: dict[str, dict[str, Any]] = {}
    modified_by_reminder: dict[str, float] = {}
    for record in records:
        candidates = record.get("sectionCandidates")
        if not isinstance(candidates, dict):
            continue
        membership_value = candidates.get("fields.MembershipsOfRemindersInSectionsAsData")
        asset = membership_value.get("downloadedAsset", {}) if isinstance(membership_value, dict) else {}
        decoded = asset.get("decodedJson", {}) if isinstance(asset, dict) else {}
        raw_memberships = decoded.get("memberships", []) if isinstance(decoded, dict) else []
        if not isinstance(raw_memberships, list):
            continue
        for membership in raw_memberships:
            if not isinstance(membership, dict):
                continue
            member_id = membership.get("memberID")
            section_id = membership.get("groupID")
            if not isinstance(member_id, str) or not isinstance(section_id, str):
                continue
            normalized_member_id = _normalized_record_identifier(member_id)
            if not normalized_member_id:
                continue
            modified_on = membership.get("modifiedOn")
            timestamp = float(modified_on) if isinstance(modified_on, (int, float)) else float("-inf")
            if timestamp < modified_by_reminder.get(normalized_member_id, float("-inf")):
                continue
            modified_by_reminder[normalized_member_id] = timestamp
            memberships_by_reminder[normalized_member_id] = {
                "sectionID": section_id,
                **({"modifiedOn": modified_on} if isinstance(modified_on, (int, float)) else {}),
            }
    return memberships_by_reminder


def _sections_from_lookup(
    summaries: list[dict[str, Any]],
    raw_records: list[dict[str, Any]],
    section_ids: dict[str, str],
    section_order: dict[str, int],
) -> list[dict[str, Any]]:
    """Pair ordered section IDs with the display names returned by CloudKit."""
    sections: list[dict[str, Any]] = []
    for summary, raw_record in zip(summaries, raw_records):
        raw_fields = raw_record.get("fields") if isinstance(raw_record.get("fields"), dict) else {}
        deleted_value = raw_fields.get("Deleted") or raw_fields.get("deleted")
        deleted = deleted_value.get("value") if isinstance(deleted_value, dict) else deleted_value
        if deleted is True:
            continue
        normalized_id = _normalized_record_identifier(raw_record.get("recordName"))
        section_id = section_ids.get(normalized_id)
        if not section_id:
            continue
        candidates = summary.get("sectionCandidates")
        name = None
        if isinstance(candidates, dict):
            for field_name, candidate in candidates.items():
                if field_name.rsplit(".", 1)[-1].lower() in _SECTION_NAME_FIELDS and isinstance(candidate, str):
                    name = candidate
                    break
        sections.append({
            "id": section_id,
            "name": name,
            "order": section_order.get(normalized_id),
        })
    sections.sort(key=lambda section: section["order"] if isinstance(section["order"], int) else 10**9)
    return sections


def _preview_reminders_with_sections(
    reminders: list[Any],
    memberships: dict[str, dict[str, Any]],
    sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    section_by_id = {
        _normalized_record_identifier(section.get("id")): section
        for section in sections
        if isinstance(section.get("id"), str)
    }
    preview: list[dict[str, Any]] = []
    for reminder in reminders:
        item = json_value(reminder)
        if not isinstance(item, dict):
            continue
        reminder_id = _normalized_record_identifier(item.get("id"))
        membership = memberships.get(reminder_id)
        if membership:
            section_id = membership.get("sectionID")
            section = section_by_id.get(_normalized_record_identifier(section_id))
            item["sectionID"] = section_id
            item["sectionName"] = section.get("name") if section else None
            item["sectionOrder"] = section.get("order") if section else None
        preview.append(item)
    return preview


def _normalized_record_identifier(value: Any) -> str:
    identifier = str(value or "").rsplit("/", 1)[-1]
    return "".join(character for character in identifier.upper() if character.isalnum())


def _selected_reminders_list(
    reminders_service: Any,
    list_key: str,
    *,
    refresh: bool = False,
) -> tuple[list[Any], Any]:
    cached_list = _REMINDER_AVAILABLE_LISTS.get(list_key)
    if cached_list is not None and not refresh:
        lists = list(_REMINDER_AVAILABLE_LISTS.values())
        if getattr(cached_list, "deleted", False) or getattr(cached_list, "is_group", False):
            raise LookupError("Choose an active iCloud Reminders list, then try again.")
        return lists, cached_list

    lists = list(reminders_service.lists())
    _remember_reminder_lists(lists)
    reminder_list = next(
        (
            item
            for item in lists
            if not getattr(item, "deleted", False)
            and not getattr(item, "is_group", False)
            and reminders_list_key(item) == list_key
        ),
        None,
    )
    if reminder_list is None:
        raise LookupError("Choose an active iCloud Reminders list, then try again.")
    return lists, reminder_list


def _remember_reminder_lists(lists: list[Any]) -> None:
    global _REMINDER_LIST_CATALOG, _REMINDER_LIST_CATALOG_DIRTY
    _REMINDER_AVAILABLE_LISTS.clear()
    for reminder_list in lists:
        key = reminders_list_key(reminder_list)
        if key:
            _REMINDER_AVAILABLE_LISTS[key] = reminder_list
    _REMINDER_LIST_CATALOG = {
        "ok": True,
        "state": "authenticated",
        "pyicloudVersion": importlib.metadata.version("pyicloud"),
        "listCount": len(lists),
        "lists": [reminders_list_summary(reminder_list) for reminder_list in lists[:50]],
    }
    _REMINDER_LIST_CATALOG_DIRTY = False


def _parse_due_date(value: Any) -> dt.datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("The due date must be an ISO date string or null.")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("The due date must be a valid ISO date string.") from exc
    return parsed


def _validate_priority(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value not in {0, 1, 5, 9}:
        raise ValueError("Priority must be one of 0, 1, 5, or 9.")
    return value


def _move_reminder_section_impl(
    reminders_service: Any,
    reminder_list: Any,
    selected_list_ref: dict[str, Any],
    list_key: str,
    reminder_id: str,
    section_id: str | None,
) -> None:
    """Update Apple's list-level membership asset using CloudKit change tags."""
    selected_list_ref["section_mutation_stage"] = "list_record_context"
    record_id = str(getattr(reminder_list, "id", ""))
    context = selected_list_ref.get("section_query_context")
    captured = context if isinstance(context, dict) else {}
    raw_client = captured.get("raw_client")
    record = captured.get("record")
    if raw_client is None or not isinstance(record, dict):
        raise RuntimeError("Apple did not return the list record needed to move this reminder.")
    if not record.get("recordChangeTag"):
        raise RuntimeError("Apple did not return a list change tag; the section move was not saved.")

    normalized_reminder_id = _normalized_record_identifier(reminder_id)
    membership_value = (record.get("fields") or {}).get("MembershipsOfRemindersInSectionsAsData")
    asset = membership_value.get("value") if isinstance(membership_value, dict) else None
    if not isinstance(asset, dict):
        raise RuntimeError("This list has no writable section membership asset.")

    if section_id is not None:
        selected_list_ref["section_mutation_stage"] = "section_validation"
        valid_sections = {
            _normalized_record_identifier(section.get("id"))
            for section in selected_list_ref.get("sections", [])
            if isinstance(section, dict) and isinstance(section.get("id"), str)
        }
        if _normalized_record_identifier(section_id) not in valid_sections:
            raise ValueError("Choose an existing section in this iCloud Reminders list.")

    selected_list_ref["section_mutation_stage"] = "membership_asset_download"
    payload_cache = selected_list_ref.get("section_asset_payloads")
    payload_cache = payload_cache if isinstance(payload_cache, dict) else None
    cache_key = _section_asset_cache_key(asset)
    reused_payload = bool(cache_key and isinstance(payload_cache.get(cache_key), bytes)) if payload_cache is not None else False
    payload = _download_section_asset_bytes(
        raw_client,
        asset,
        payload_cache,
    )
    selected_list_ref["section_mutation_stage"] = "membership_asset_decode"
    try:
        document = _decode_section_memberships(payload)
    except SectionAssetDecodeError:
        if not reused_payload or payload_cache is None or cache_key is None:
            raise
        # Avoid retrying a stale/colliding local asset cache entry once. CloudKit
        # asset URLs are scoped to this record response, so a fresh download is
        # the safest recovery before refusing the mutation.
        payload_cache.pop(cache_key, None)
        payload = _download_section_asset_bytes(raw_client, asset, payload_cache)
        document = _decode_section_memberships(payload)

    memberships = [
        membership
        for membership in document["memberships"]
        if not (
            isinstance(membership, dict)
            and _normalized_record_identifier(membership.get("memberID")) == normalized_reminder_id
        )
    ]
    if section_id is not None:
        memberships.append({
            "memberID": reminder_id.rsplit("/", 1)[-1],
            "groupID": section_id,
            "modifiedOn": dt.datetime.now(dt.timezone.utc).timestamp() - 978307200,
        })
    document["memberships"] = memberships
    document.setdefault("minimumSupportedVersion", 20230430)
    updated_payload = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    cloudkit_client = getattr(raw_client, "_client", None)
    http = getattr(cloudkit_client, "_http", None)
    post = getattr(http, "post", None)
    if not callable(post):
        raise RuntimeError("This PyICloud version cannot update section assets.")
    record_name = record.get("recordName")
    zone_id = record.get("zoneID")
    if not isinstance(record_name, str) or not isinstance(zone_id, dict):
        raise RuntimeError("Apple's list record is missing its CloudKit routing metadata.")

    selected_list_ref["section_mutation_stage"] = "asset_upload_token"
    token_response = post("/assets/upload", {
        "zoneID": zone_id,
        "tokens": [{
            "recordType": "List",
            "recordName": record_name,
            "fieldName": "MembershipsOfRemindersInSectionsAsData",
        }],
    })
    tokens = token_response.get("tokens") if isinstance(token_response, dict) else None
    upload_url = tokens[0].get("url") if isinstance(tokens, list) and tokens and isinstance(tokens[0], dict) else None
    if not isinstance(upload_url, str):
        raise RuntimeError("Apple did not return a section asset upload URL.")
    upload_parts = urlsplit(upload_url)
    if upload_parts.scheme != "https" or not upload_parts.hostname:
        raise RuntimeError("Apple returned an invalid section asset upload URL.")
    session = getattr(api, "session", None)
    upload = getattr(session, "post", None)
    if not callable(upload):
        raise RuntimeError("This PyICloud version cannot upload section assets.")
    selected_list_ref["section_mutation_stage"] = "asset_upload"
    upload_response = upload(
        upload_url,
        data=updated_payload,
        headers={"Content-Type": "application/octet-stream"},
        timeout=30,
    )
    if not getattr(upload_response, "ok", False):
        status = getattr(upload_response, "status_code", None)
        raise SectionMutationError(
            "asset_upload",
            http_status=status,
            message="iCloud rejected the section update. Refresh the list and try again.",
        )
    selected_list_ref["section_mutation_stage"] = "asset_upload_response"
    try:
        asset_response = upload_response.json()
    except Exception as exc:
        raise RuntimeError("Apple returned an invalid section asset upload response.") from exc
    uploaded_asset = asset_response.get("singleFile") if isinstance(asset_response, dict) else None
    required_asset_fields = {"fileChecksum", "size", "wrappingKey", "referenceChecksum", "receipt"}
    if not isinstance(uploaded_asset, dict) or not required_asset_fields.issubset(uploaded_asset):
        raise RuntimeError("Apple's section asset upload response is incomplete.")

    selected_list_ref["section_mutation_stage"] = "list_record_update"
    updated_record = post("/records/modify", {
        "zoneID": zone_id,
        "operations": [{
            "operationType": "update",
            "record": {
                "recordType": "List",
                "recordName": record_name,
                "recordChangeTag": record.get("recordChangeTag"),
                "fields": {
                    "MembershipsOfRemindersInSectionsAsData": {"value": uploaded_asset},
                    "MembershipsOfRemindersInSectionsChecksum": {
                        "value": hashlib.sha512(updated_payload).hexdigest(),
                    },
                },
            },
        }],
    })
    results = updated_record.get("records") if isinstance(updated_record, dict) else None
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        raise RuntimeError("Apple did not confirm the section membership update.")
    update_result = results[0]
    error_code = update_result.get("serverErrorCode") or update_result.get("errorCode")
    if error_code:
        code = _safe_cloudkit_error_code(error_code)
        if code in {"ZONE_WIDE_WILDCARD", "CONFLICT", "SERVER_RECORD_CHANGED"}:
            raise SectionMutationError(
                "list_record_update",
                apple_error_code=code,
                message="The list changed while the reminder was moving. Refresh and try again.",
            )
        raise SectionMutationError("list_record_update", apple_error_code=code)
    if not isinstance(update_result.get("recordChangeTag"), str):
        raise RuntimeError("Apple returned no change tag for the section update.")


def _move_reminder_section(
    reminders_service: Any,
    reminder_list: Any,
    selected_list_ref: dict[str, Any],
    list_key: str,
    reminder_id: str,
    section_id: str | None,
) -> None:
    try:
        _move_reminder_section_impl(
            reminders_service,
            reminder_list,
            selected_list_ref,
            list_key,
            reminder_id,
            section_id,
        )
    except SectionMutationError:
        raise
    except ValueError as exc:
        if selected_list_ref.get("section_mutation_stage") == "section_validation":
            raise
        raise _section_mutation_error(
            exc,
            str(selected_list_ref.get("section_mutation_stage") or "section_update"),
        ) from exc
    except Exception as exc:
        raise _section_mutation_error(
            exc,
            str(selected_list_ref.get("section_mutation_stage") or "section_update"),
        ) from exc
    finally:
        selected_list_ref.pop("section_mutation_stage", None)


def _cloudkit_record_summaries(
    response: Any,
    selected_record_id_hash: str | None = None,
    raw_client: Any = None,
    asset_payload_cache: dict[str, bytes] | None = None,
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
        for error_key in ("serverErrorCode", "errorCode", "code"):
            error_code = record.get(error_key)
            if isinstance(error_code, (str, int)) and not isinstance(error_code, bool):
                summary["recordErrorCode"] = str(error_code)[:100]
                break
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
                        lambda asset, _raw_client=raw_client, _payload_cache=asset_payload_cache: _download_section_asset(
                            _raw_client,
                            asset,
                            _payload_cache,
                        )
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
) -> list[str]:
    section_ids = selected_list_ref.get("section_ids")
    if isinstance(section_ids, list):
        return section_ids
    selected_record_id_hash = _short_hash(selected_list_id)
    captured = selected_list_ref.get("section_records", {}).get(selected_record_id_hash)
    if not isinstance(captured, dict):
        return set()
    record = captured.get("record")
    raw_client = captured.get("raw_client")
    if not isinstance(record, dict):
        return set()
    record_count, record_type_counts, records = _cloudkit_record_summaries(
        {"records": [record]},
        selected_record_id_hash=selected_record_id_hash,
        raw_client=raw_client,
        asset_payload_cache=selected_list_ref.setdefault("section_asset_payloads", {}),
    )
    section_ids, ordered_section_ids = _section_ids_from_summaries(records)
    selected_list_ref["section_ids"] = section_ids
    selected_list_ref["ordered_section_ids"] = ordered_section_ids
    selected_list_ref["section_memberships"] = _section_memberships_from_summaries(records)
    selected_list_ref["section_asset_fingerprint"] = _section_asset_fingerprint(record)
    selected_list_ref["section_query_context"] = captured
    return section_ids


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
            response_to_summarize = response
            raw_response_records = _cloudkit_response_records(response)
            lookup_record_type = None
            candidate_count = None
            lookup_result_count = None
            lookup_order: dict[str, int] = {}
            lookup_section_ids: dict[str, str] = {}
            if operation == "records/lookup" and isinstance(payload, dict):
                requested_records = payload.get("records")
                section_ids = selected_list_ref.get("section_ids", []) if selected_list_ref else []
                ordered_section_ids = selected_list_ref.get("ordered_section_ids", []) if selected_list_ref else []
                for index, section_id in enumerate(ordered_section_ids):
                    if isinstance(section_id, str):
                        normalized_id = _normalized_record_identifier(section_id)
                        lookup_order[normalized_id] = index
                for section_id in section_ids:
                    if isinstance(section_id, str):
                        normalized_id = _normalized_record_identifier(section_id)
                        lookup_section_ids[normalized_id] = section_id
                requested_ids = {
                    _normalized_record_identifier(item.get("recordName"))
                    for item in requested_records
                    if isinstance(item, dict) and isinstance(item.get("recordName"), str)
                } if isinstance(requested_records, list) else set()
                if requested_ids and requested_ids.issubset(lookup_section_ids):
                    lookup_record_type = "ListSection"
                    candidate_count = len(requested_ids)
                    lookup_result_count = len(raw_response_records)
            record_count, record_type_counts, records = _cloudkit_record_summaries(
                response_to_summarize,
                selected_record_id_hash=selected_record_id_hash,
                raw_client=_raw_client,
                asset_payload_cache=(
                    selected_list_ref.setdefault("section_asset_payloads", {})
                    if selected_list_ref is not None
                    else None
                ),
            )
            if selected_list_ref is not None and selected_record_id_hash:
                selected_summaries = [
                    summary for summary in records
                    if summary.get("recordIdHash") == selected_record_id_hash
                    and summary.get("recordType", "").lower() == "list"
                ]
                if selected_summaries:
                    selected_list_ref["section_ids"], selected_list_ref["ordered_section_ids"] = (
                        _section_ids_from_summaries(selected_summaries)
                    )
                    selected_list_ref["section_memberships"] = _section_memberships_from_summaries(
                        selected_summaries
                    )
                    captured = selected_list_ref.get("section_records", {}).get(selected_record_id_hash)
                    if isinstance(captured, dict) and isinstance(captured.get("record"), dict):
                        selected_list_ref["section_asset_fingerprint"] = _section_asset_fingerprint(
                            captured["record"]
                        )
                    if isinstance(captured, dict):
                        selected_list_ref["section_query_context"] = captured
            if lookup_record_type:
                for summary, raw_record in zip(records, raw_response_records):
                    normalized_id = _normalized_record_identifier(raw_record.get("recordName"))
                    section_id = lookup_section_ids.get(normalized_id)
                    if section_id:
                        if summary["recordType"] == "<unknown>":
                            summary["recordType"] = lookup_record_type
                        summary["sectionID"] = section_id[:100]
                        summary["sectionOrder"] = lookup_order.get(normalized_id)
                if selected_list_ref is not None:
                    selected_list_ref["sections"] = _sections_from_lookup(
                        records,
                        raw_response_records,
                        lookup_section_ids,
                        lookup_order,
                    )
            return response

        http.post = inspected_post
        patched.append((http, original_post))

    try:
        yield
    finally:
        for http, original_post in patched:
            http.post = original_post


def safe_error(exc: Exception) -> dict[str, Any]:
    name = type(exc).__name__
    if isinstance(exc, PyiCloudFailedLoginException):
        result: dict[str, Any] = {
            "errorCode": "invalid_credentials",
            "error": "Apple rejected the Apple ID or password.",
        }
    elif "Connection" in name or "Timeout" in name:
        result = {"errorCode": "apple_unreachable", "error": "Could not reach Apple iCloud."}
    elif "AccountLocked" in name:
        result = {
            "errorCode": "account_locked",
            "error": "Apple temporarily locked this account. Try again later.",
        }
    elif "AcceptTerms" in name:
        result = {
            "errorCode": "terms_required",
            "error": "Apple requires updated iCloud terms to be accepted.",
        }
    else:
        result = {
            "errorCode": "icloud_request_failed",
            "error": "PyICloud could not complete the request.",
        }

    # Exception class, Apple code, and HTTP status are safe diagnostics; never
    # expose exception text, which may contain account or request data.
    detail = _safe_cloudkit_error_code(name)
    if detail:
        result["failureDetail"] = detail
    code = _safe_cloudkit_error_code(getattr(exc, "code", None))
    if code:
        result["appleErrorCode"] = code
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if status is None:
        status = getattr(exc, "status_code", None)
    if isinstance(status, int) and 100 <= status <= 599:
        result["httpStatus"] = status
    return result


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
    global api, auth_mode, two_step_devices, two_step_device, _REMINDER_SYNC_CURSOR
    global _REMINDER_LIST_CATALOG, _REMINDER_LIST_CATALOG_DIRTY
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
    _REMINDER_LIST_CACHE.clear()
    _REMINDER_AVAILABLE_LISTS.clear()
    _REMINDER_LIST_CATALOG = None
    _REMINDER_LIST_CATALOG_DIRTY = True
    _REMINDER_SYNC_CURSOR = None
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
        _sync_cached_reminder_changes(reminders_service)
        if _REMINDER_LIST_CATALOG is not None and not _REMINDER_LIST_CATALOG_DIRTY:
            return json.loads(json.dumps(_REMINDER_LIST_CATALOG, ensure_ascii=False))
        lists = list(reminders_service.lists())
        _remember_reminder_lists(lists)
        return json.loads(json.dumps(_REMINDER_LIST_CATALOG, ensure_ascii=False))
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def _query_section_records(
    reminders_service: Any,
    selected_list_ref: dict[str, Any],
    list_key: str,
    request_id: str,
) -> None:
    section_ids = _log_selected_section_assets(
        selected_list_ref,
        list_key,
        request_id,
        str(selected_list_ref.get("id") or ""),
    )
    if not section_ids:
        return
    context = selected_list_ref.get("section_query_context", {})
    raw_client = context.get("raw_client") if isinstance(context, dict) else None
    cloudkit_client = getattr(raw_client, "_client", None)
    http = getattr(cloudkit_client, "_http", None)
    post = getattr(http, "post", None)
    if not callable(post):
        return
    selected_record = context.get("record") if isinstance(context, dict) else None
    zone_id = selected_record.get("zoneID") if isinstance(selected_record, dict) else None
    if not isinstance(zone_id, dict) or not isinstance(zone_id.get("zoneName"), str):
        zone_id = {"zoneName": "Reminders", "ownerRecordName": "_defaultOwner"}
    lookup_payload = {
        "zoneID": zone_id,
        "records": [{"recordName": f"ListSection/{section_id}"} for section_id in section_ids],
    }
    try:
        # PyICloud appends operation paths to the base URL; keep the slash.
        post("/records/lookup", lookup_payload)
    except Exception as section_lookup_exc:
        error_code = getattr(section_lookup_exc, "code", None)
        response = getattr(section_lookup_exc, "response", None)
        status_code = getattr(response, "status_code", None)
        selected_list_ref["section_lookup_error"] = (
            status_code if isinstance(status_code, int)
            else error_code if isinstance(error_code, (str, int))
            else type(section_lookup_exc).__name__
        )


def _load_list_section_context(
    reminders_service: Any,
    list_key: str,
    request_id: str,
) -> tuple[list[Any], Any, dict[str, Any]]:
    selected_list_ref: dict[str, Any] = {}
    with inspect_cloudkit_responses(reminders_service, list_key, request_id, selected_list_ref):
        lists, reminder_list = _selected_reminders_list(reminders_service, list_key, refresh=True)
        selected_list_ref["id"] = str(getattr(reminder_list, "id", ""))
        _query_section_records(reminders_service, selected_list_ref, list_key, request_id)
    if selected_list_ref.get("section_lookup_error"):
        raise RuntimeError(
            f"Apple could not look up this list's sections (HTTP {selected_list_ref['section_lookup_error']})."
        )
    return lists, reminder_list, selected_list_ref


def _load_list_snapshot(
    reminders_service: Any,
    list_key: str,
    request_id: str,
    results_limit: int,
) -> tuple[list[Any], Any, Any, dict[str, Any]]:
    selected_list_ref: dict[str, Any] = {}
    with inspect_cloudkit_responses(reminders_service, list_key, request_id, selected_list_ref):
        lists, reminder_list = _selected_reminders_list(reminders_service, list_key, refresh=True)
        selected_list_ref["id"] = str(getattr(reminder_list, "id", ""))
        _query_section_records(reminders_service, selected_list_ref, list_key, request_id)
        batch = reminders_service.list_reminders(
            reminder_list,
            include_completed=True,
            results_limit=results_limit,
        )
    return lists, reminder_list, batch, selected_list_ref


def _reminder_sync_supported(reminders_service: Any) -> bool:
    return callable(getattr(reminders_service, "sync_cursor", None)) and callable(
        getattr(reminders_service, "iter_changes", None)
    )


def _list_route(reminder_list: Any) -> tuple[str, str, str | None, str]:
    return (
        str(getattr(reminder_list, "scope", "private")),
        str(getattr(reminder_list, "zone_name", "Reminders")),
        getattr(reminder_list, "zone_owner", None),
        str(getattr(reminder_list, "id", "")),
    )


def _apply_reminder_change(event: Any) -> None:
    reminder = getattr(event, "reminder", None)
    reminder_id = getattr(event, "reminder_id", None) or getattr(reminder, "id", None)
    normalized_id = _normalized_record_identifier(reminder_id)
    event_type_value = getattr(event, "type", "")
    event_type = str(getattr(event_type_value, "value", event_type_value)).lower().rsplit(".", 1)[-1]
    if reminder is None or event_type == "deleted":
        if normalized_id:
            for cache in _REMINDER_LIST_CACHE.values():
                response = cache.get("response")
                records = response.get("lists", []) if isinstance(response, dict) else []
                if records and isinstance(records[0], dict):
                    previous_count = len(records[0].get("reminders", []))
                    records[0]["reminders"] = [
                        row for row in records[0].get("reminders", [])
                        if _normalized_record_identifier(row.get("id")) != normalized_id
                    ]
                    records[0]["reminderCountReturned"] = len(records[0]["reminders"])
                    if len(records[0]["reminders"]) != previous_count:
                        _bump_cache_revision(cache)
        return

    reminder_data = json_value(reminder)
    if not isinstance(reminder_data, dict):
        return
    for key in ("scope", "zone_name", "zone_owner", "id", "list_id"):
        value = getattr(reminder, key, None)
        if value is not None:
            reminder_data.setdefault(key, value)
    route = (
        str(getattr(reminder, "scope", "private")),
        str(getattr(reminder, "zone_name", "Reminders")),
        getattr(reminder, "zone_owner", None),
        str(getattr(reminder, "list_id", "")),
    )
    for cache in _REMINDER_LIST_CACHE.values():
        if cache.get("route") != route:
            continue
        response = cache.get("response")
        lists = response.get("lists", []) if isinstance(response, dict) else []
        if not lists or not isinstance(lists[0], dict):
            continue
        rows = lists[0].get("reminders", [])
        previous = next(
            (row for row in rows if _normalized_record_identifier(row.get("id")) == normalized_id),
            None,
        )
        if previous:
            for field in ("sectionID", "sectionName", "sectionOrder"):
                if field not in reminder_data and field in previous:
                    reminder_data[field] = previous[field]
            rows[rows.index(previous)] = reminder_data
        else:
            rows.append(reminder_data)
        lists[0]["reminderCountReturned"] = len(rows)
        _bump_cache_revision(cache)


def _cloudkit_change_record_dict(record: Any) -> dict[str, Any]:
    if isinstance(record, dict):
        return record
    value = json_value(record)
    return value if isinstance(value, dict) else {}


def _invalidate_list_metadata_change(record: Any) -> None:
    """Invalidate only the list/section snapshots touched by a CloudKit delta."""
    global _REMINDER_LIST_CATALOG_DIRTY
    data = _cloudkit_change_record_dict(record)
    record_type = str(data.get("recordType") or getattr(record, "recordType", ""))
    record_name = str(data.get("recordName") or getattr(record, "recordName", ""))
    normalized_name = _normalized_record_identifier(record_name)
    normalized_type = record_type.lower()

    if normalized_type == "list" or record_name.lower().startswith("list/"):
        _REMINDER_LIST_CATALOG_DIRTY = True
        for cache in _REMINDER_LIST_CACHE.values():
            route = cache.get("route")
            if not isinstance(route, tuple) or not route or _normalized_record_identifier(route[-1]) != normalized_name:
                continue
            cache["sections_loaded"] = False
            _bump_cache_revision(cache)
        return

    is_section = normalized_type == "listsection" or record_name.lower().startswith("listsection/")
    if not is_section:
        return
    section_id = normalized_name
    for cache in _REMINDER_LIST_CACHE.values():
        response = cache.get("response")
        lists = response.get("lists", []) if isinstance(response, dict) else []
        if not lists or not isinstance(lists[0], dict):
            continue
        summary = lists[0]
        section_ids = {
            _normalized_record_identifier(section.get("id"))
            for section in summary.get("sections", [])
            if isinstance(section, dict) and isinstance(section.get("id"), str)
        }
        reminder_section_ids = {
            _normalized_record_identifier(reminder.get("sectionID"))
            for reminder in summary.get("reminders", [])
            if isinstance(reminder, dict) and isinstance(reminder.get("sectionID"), str)
        }
        if section_id in section_ids or section_id in reminder_section_ids:
            cache["sections_loaded"] = False
            _bump_cache_revision(cache)


def _read_list_metadata_changes(reminders_service: Any, since: str) -> bool:
    """Read list and ListSection records from the same zone delta cursor."""
    reads = getattr(reminders_service, "_reads", None)
    iterator = getattr(reads, "_iter_zone_change_pages", None)
    if not callable(iterator):
        return False
    desired_keys = [
        "Name",
        "Deleted",
        "ReminderIDs",
        "MembershipsOfRemindersInSectionsAsData",
        "MembershipsOfRemindersInSectionsChecksum",
        "SectionIDsOrderingAsData",
        "DisplayName",
        "CanonicalName",
    ]
    for page in iterator(
        desired_record_types=["List", "ListSection"],
        desired_keys=desired_keys,
        sync_token=since,
        reverse=False,
    ):
        for record in getattr(page, "records", []) or []:
            _invalidate_list_metadata_change(record)
    return True


def _read_reminder_changes(reminders_service: Any, since: str | None) -> bool:
    """Advance the account-wide cursor and apply only changed reminders to cached lists."""
    global _REMINDER_SYNC_CURSOR, _REMINDER_LIST_CATALOG_DIRTY
    if not _reminder_sync_supported(reminders_service):
        return False
    try:
        next_cursor = reminders_service.sync_cursor()
        if since and since != next_cursor:
            for event in reminders_service.iter_changes(since=since):
                _apply_reminder_change(event)
            if not _read_list_metadata_changes(reminders_service, since):
                # Pinned PyICloud exposes the zone-page reader. If it is absent,
                # fall back conservatively so the cache cannot hide metadata edits.
                _REMINDER_LIST_CATALOG_DIRTY = True
                for cache in _REMINDER_LIST_CACHE.values():
                    cache["sections_loaded"] = False
        _REMINDER_SYNC_CURSOR = next_cursor
        return True
    except Exception:
        _REMINDER_SYNC_CURSOR = None
        _REMINDER_LIST_CACHE.clear()
        _REMINDER_LIST_CATALOG_DIRTY = True
        return False


def _sync_cached_reminder_changes(reminders_service: Any) -> bool:
    global _REMINDER_SYNC_CURSOR, _REMINDER_LIST_CATALOG_DIRTY
    if not _reminder_sync_supported(reminders_service):
        _REMINDER_LIST_CACHE.clear()
        _REMINDER_SYNC_CURSOR = None
        _REMINDER_LIST_CATALOG_DIRTY = True
        return False
    if _REMINDER_SYNC_CURSOR is None:
        try:
            _REMINDER_SYNC_CURSOR = reminders_service.sync_cursor()
        except Exception:
            _REMINDER_LIST_CACHE.clear()
            _REMINDER_LIST_CATALOG_DIRTY = True
            return False
        return True
    return _read_reminder_changes(reminders_service, _REMINDER_SYNC_CURSOR)


def _cache_list_response(
    list_key: str,
    response: dict[str, Any],
    reminder_list: Any,
    *,
    sections_loaded: bool,
    section_asset_fingerprint: str | None = None,
) -> None:
    revision = _next_reminder_revision()
    cached_response = json.loads(json.dumps(response, ensure_ascii=False))
    cached_response["revision"] = revision
    _REMINDER_LIST_CACHE[list_key] = {
        "response": cached_response,
        "route": _list_route(reminder_list),
        "sections_loaded": sections_loaded,
        "revision": revision,
        "section_asset_fingerprint": section_asset_fingerprint or "",
    }


def _next_reminder_revision() -> int:
    global _REMINDER_REVISION_SEQUENCE
    _REMINDER_REVISION_SEQUENCE += 1
    return _REMINDER_REVISION_SEQUENCE


def _bump_cache_revision(cache: dict[str, Any]) -> None:
    revision = _next_reminder_revision()
    cache["revision"] = revision
    response = cache.get("response")
    if isinstance(response, dict):
        response["revision"] = revision


def _cache_revision(list_key: str) -> int | None:
    cache = _REMINDER_LIST_CACHE.get(list_key)
    revision = cache.get("revision") if isinstance(cache, dict) else None
    return revision if isinstance(revision, int) else None


def _cached_list_response(list_key: str) -> dict[str, Any] | None:
    cache = _REMINDER_LIST_CACHE.get(list_key)
    response = cache.get("response") if isinstance(cache, dict) else None
    return json.loads(json.dumps(response, ensure_ascii=False)) if isinstance(response, dict) else None


def _cache_mutated_reminder(list_key: str, reminder_data: dict[str, Any]) -> None:
    cache = _REMINDER_LIST_CACHE.get(list_key)
    response = cache.get("response") if isinstance(cache, dict) else None
    lists = response.get("lists", []) if isinstance(response, dict) else []
    if not lists or not isinstance(lists[0], dict):
        return
    reminders = lists[0].setdefault("reminders", [])
    normalized_id = _normalized_record_identifier(reminder_data.get("id"))
    previous_index = next(
        (index for index, row in enumerate(reminders)
         if _normalized_record_identifier(row.get("id")) == normalized_id),
        None,
    )
    if previous_index is not None:
        previous = reminders[previous_index]
        for field in ("sectionID", "sectionName", "sectionOrder"):
            if field not in reminder_data and field in previous:
                reminder_data[field] = previous[field]
        reminders[previous_index] = reminder_data
    else:
        reminders.append(reminder_data)
    lists[0]["reminderCountReturned"] = len(reminders)
    _bump_cache_revision(cache)


def _cache_deleted_reminder(list_key: str, reminder_id: str) -> None:
    cache = _REMINDER_LIST_CACHE.get(list_key)
    response = cache.get("response") if isinstance(cache, dict) else None
    lists = response.get("lists", []) if isinstance(response, dict) else []
    if not lists or not isinstance(lists[0], dict):
        return
    rows = lists[0].get("reminders", [])
    normalized_id = _normalized_record_identifier(reminder_id)
    lists[0]["reminders"] = [
        row for row in rows if _normalized_record_identifier(row.get("id")) != normalized_id
    ]
    lists[0]["reminderCountReturned"] = len(lists[0]["reminders"])
    if len(rows) != len(lists[0]["reminders"]):
        _bump_cache_revision(cache)


def fetch_preview(request: dict[str, Any]) -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    try:
        reminders_service = api.reminders
        selected_key = str(request.get("listKey") or "")
        request_id = str(request.get("requestId") or "")[:100]
        results_limit = 200 if request.get("fullList") is True else 10
        lists, reminder_list, batch, selected_list_ref = _load_list_snapshot(
            reminders_service,
            selected_key,
            request_id,
            results_limit,
        )
        reminders = list(getattr(batch, "reminders", []) or [])
        summary = reminders_list_summary(reminder_list)
        sections = selected_list_ref.get("sections", [])
        if not isinstance(sections, list):
            sections = []
        section_memberships = selected_list_ref.get("section_memberships", {})
        if not isinstance(section_memberships, dict):
            section_memberships = {}
        preview_reminders = _preview_reminders_with_sections(
            reminders if results_limit > 10 else reminders[:10],
            section_memberships,
            sections,
        )
        summary["reminderCountReturned"] = len(reminders)
        summary["sections"] = sections
        summary["reminders"] = preview_reminders
        result = {
            "ok": True,
            "state": "fetched",
            "pyicloudVersion": importlib.metadata.version("pyicloud"),
            "listCount": len(lists),
            "lists": [summary],
        }
        if request.get("includeDiagnostic") is not False:
            result["decodedAppleSample"] = {
                "listFields": object_fields(reminder_list),
                "list": json_value(reminder_list),
                "snapshotFields": object_fields(batch),
                "snapshot": json_value(batch),
                "reminderFields": sorted(
                    {field for reminder in reminders for field in object_fields(reminder)}
                ),
                "sections": sections,
                "reminders": preview_reminders,
            }
        if request.get("_cacheSnapshot") is True:
            _cache_list_response(
                selected_key,
                {key: value for key, value in result.items() if key != "decodedAppleSample"},
                reminder_list,
                sections_loaded=True,
                section_asset_fingerprint=selected_list_ref.get("section_asset_fingerprint"),
            )
        return result
    except LookupError as exc:
        return {"ok": False, "errorCode": "selected_list_not_found", "error": str(exc)}
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def fetch_list(request: dict[str, Any]) -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    list_key = str(request.get("listKey") or "")
    reminders_service = api.reminders
    _sync_cached_reminder_changes(reminders_service)
    cached = _REMINDER_LIST_CACHE.get(list_key)
    if cached and cached.get("sections_loaded"):
        revision = cached.get("revision")
        if request.get("revision") == revision:
            return {"ok": True, "state": "unchanged", "changed": False, "revision": revision}
        response = _cached_list_response(list_key)
        if response is not None:
            response["state"] = "fetched"
            response["changed"] = True
            return response

    cursor_before = _REMINDER_SYNC_CURSOR
    response = fetch_preview({
        **request,
        "fullList": True,
        "includeDiagnostic": False,
        "_cacheSnapshot": True,
    })
    if response.get("ok"):
        if _reminder_sync_supported(reminders_service):
            _read_reminder_changes(reminders_service, cursor_before)
        cached_response = _cached_list_response(list_key) or response
        revision = cached_response.get("revision")
        if request.get("revision") == revision:
            return {"ok": True, "state": "unchanged", "changed": False, "revision": revision}
        cached_response["changed"] = True
        return cached_response
    return response


def fetch_task_lists(request: dict[str, Any]) -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    try:
        reminders_service = api.reminders
        _sync_cached_reminder_changes(reminders_service)
        requested_keys = request.get("listKeys")
        keys = {
            str(value)
            for value in requested_keys
            if isinstance(value, str) and len(value) == 64
        } if isinstance(requested_keys, list) else set()
        requested_revisions = request.get("revisions")
        requested_revisions = requested_revisions if isinstance(requested_revisions, dict) else {}
        missing_keys = keys.difference(_REMINDER_LIST_CACHE)
        uncached_list_keys = missing_keys.difference(_REMINDER_AVAILABLE_LISTS)
        if uncached_list_keys:
            lists = list(reminders_service.lists())
            _remember_reminder_lists(lists)
        elif missing_keys:
            lists = list(_REMINDER_AVAILABLE_LISTS.values())
        else:
            lists = []
        selected = [
            reminder_list
            for reminder_list in lists
            if not getattr(reminder_list, "deleted", False)
            and not getattr(reminder_list, "is_group", False)
            and reminders_list_key(reminder_list) in keys
        ]
        cursor_before = _REMINDER_SYNC_CURSOR
        for reminder_list in selected:
            list_key = reminders_list_key(reminder_list)
            if list_key in _REMINDER_LIST_CACHE:
                continue
            batch = reminders_service.list_reminders(
                reminder_list,
                include_completed=True,
                results_limit=200,
            )
            reminders = [
                json_value(reminder)
                for reminder in (getattr(batch, "reminders", []) or [])
                if not getattr(reminder, "deleted", False)
            ]
            summary = reminders_list_summary(reminder_list)
            summary["reminderCountReturned"] = len(reminders)
            summary["sections"] = []
            summary["reminders"] = reminders
            response = {
                "ok": True,
                "state": "fetched",
                "pyicloudVersion": importlib.metadata.version("pyicloud"),
                "listCount": len(lists),
                "lists": [summary],
            }
            _cache_list_response(
                list_key,
                response,
                reminder_list,
                sections_loaded=False,
            )
        if selected and _reminder_sync_supported(reminders_service):
            _read_reminder_changes(reminders_service, cursor_before)
        cache_keys = {reminders_list_key(reminder_list) for reminder_list in selected}
        cache_keys.update(keys.intersection(_REMINDER_LIST_CACHE))
        snapshots: list[dict[str, Any]] = []
        current_revisions: dict[str, int] = {}
        for list_key in cache_keys:
            cached = _REMINDER_LIST_CACHE.get(list_key)
            if not isinstance(cached, dict):
                continue
            revision = cached.get("revision")
            if not isinstance(revision, int):
                continue
            current_revisions[list_key] = revision
            if requested_revisions.get(list_key) == revision:
                continue
            response = _cached_list_response(list_key)
            if response is not None:
                snapshots.extend(response.get("lists", []))
        list_count = max(
            (
                cache.get("response", {}).get("listCount", 0)
                for list_key in cache_keys
                if isinstance((cache := _REMINDER_LIST_CACHE.get(list_key)), dict)
                and isinstance(cache.get("response"), dict)
            ),
            default=0,
        )
        return {
            "ok": True,
            "state": "fetched" if snapshots else "unchanged",
            "changed": bool(snapshots),
            "pyicloudVersion": importlib.metadata.version("pyicloud"),
            "listCount": list_count,
            "lists": snapshots,
            "revisions": current_revisions,
        }
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def create_reminder(request: dict[str, Any]) -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    created_reminder_id: str | None = None
    try:
        title = str(request.get("title") or "").strip()
        if not title:
            raise ValueError("A reminder title is required.")
        if len(title) > 1000:
            raise ValueError("Reminder titles must be 1,000 characters or fewer.")
        reminders_service = api.reminders
        list_key = str(request.get("listKey") or "")
        section_id = request.get("sectionID")
        if section_id is not None:
            section_id = str(section_id)
            lists, reminder_list, selected_ref = _load_list_section_context(
                reminders_service, list_key, str(request.get("requestId") or "")[:100]
            )
            valid_section_ids = {
                _normalized_record_identifier(section.get("id"))
                for section in selected_ref.get("sections", [])
                if isinstance(section, dict) and isinstance(section.get("id"), str)
            }
            if _normalized_record_identifier(section_id) not in valid_section_ids:
                raise ValueError("Choose an existing section in this iCloud Reminders list.")
        else:
            lists, reminder_list = _selected_reminders_list(reminders_service, list_key)
            selected_ref = {}
        created = reminders_service.create(
            list_id=reminder_list,
            title=title,
            desc=str(request.get("desc") or ""),
            due_date=_parse_due_date(request.get("dueDate")),
            priority=_validate_priority(request.get("priority", 0)),
            flagged=bool(request.get("flagged", False)),
            all_day=bool(request.get("allDay", False)),
        )
        created_reminder_id = str(getattr(created, "id", "")) or None
        if section_id is not None:
            _move_reminder_section(
                reminders_service,
                reminder_list,
                selected_ref,
                list_key,
                created_reminder_id or "",
                str(section_id),
            )
        created_data = json_value(created)
        if not isinstance(created_data, dict):
            created_data = {}
        if section_id is not None:
            selected_section = next(
                (
                    section for section in selected_ref.get("sections", [])
                    if isinstance(section, dict)
                    and _normalized_record_identifier(section.get("id"))
                    == _normalized_record_identifier(section_id)
                ),
                None,
            )
            created_data.update({
                "sectionID": section_id,
                "sectionName": selected_section.get("name") if selected_section else None,
                "sectionOrder": selected_section.get("order") if selected_section else None,
            })
        _cache_mutated_reminder(reminders_list_key(reminder_list), created_data)
        return {
            "ok": True,
            "state": "created",
            "listCount": len(lists),
            "reminder": created_data,
            "revision": _cache_revision(reminders_list_key(reminder_list)),
        }
    except (ValueError, LookupError) as exc:
        return {"ok": False, "errorCode": "invalid_request", "error": str(exc)}
    except SectionMutationError as exc:
        return _section_mutation_failure(exc, reminder_id=created_reminder_id)
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def update_reminder(request: dict[str, Any]) -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    try:
        reminders_service = api.reminders
        _, reminder_list = _selected_reminders_list(reminders_service, str(request.get("listKey") or ""))
        reminder_id = str(request.get("reminderId") or "").strip()
        if not reminder_id:
            raise ValueError("A reminder ID is required.")
        reminder = reminders_service.get(reminder_id, list_context=reminder_list)
        if str(getattr(reminder, "list_id", "")) != str(getattr(reminder_list, "id", "")):
            raise ValueError("That reminder does not belong to the selected list.")
        patch = request.get("patch")
        if not isinstance(patch, dict) or not patch:
            raise ValueError("Provide at least one reminder field to update.")
        if "title" in patch:
            title = str(patch.get("title") or "").strip()
            if not title:
                raise ValueError("A reminder title is required.")
            if len(title) > 1000:
                raise ValueError("Reminder titles must be 1,000 characters or fewer.")
            reminder.title = title
        if "desc" in patch:
            reminder.desc = str(patch.get("desc") or "")
        if "dueDate" in patch:
            reminder.due_date = _parse_due_date(patch.get("dueDate"))
            if "timeZone" in patch:
                reminder.time_zone = patch.get("timeZone") or None
        if "priority" in patch:
            reminder.priority = _validate_priority(patch["priority"])
        if "flagged" in patch:
            reminder.flagged = bool(patch["flagged"])
        if "completed" in patch:
            reminder.completed = bool(patch["completed"])
            reminder.completed_date = (
                dt.datetime.now(dt.timezone.utc) if reminder.completed else None
            )
        if "allDay" in patch:
            reminder.all_day = bool(patch["allDay"])
        reminders_service.update(reminder)
        reminder_data = json_value(reminder)
        if isinstance(reminder_data, dict):
            _cache_mutated_reminder(reminders_list_key(reminder_list), reminder_data)
        return {
            "ok": True,
            "state": "updated",
            "reminder": reminder_data,
            "revision": _cache_revision(reminders_list_key(reminder_list)),
        }
    except (ValueError, LookupError) as exc:
        return {"ok": False, "errorCode": "invalid_request", "error": str(exc)}
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def delete_reminder(request: dict[str, Any]) -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    try:
        reminders_service = api.reminders
        _, reminder_list = _selected_reminders_list(reminders_service, str(request.get("listKey") or ""))
        reminder_id = str(request.get("reminderId") or "").strip()
        if not reminder_id:
            raise ValueError("A reminder ID is required.")
        reminder = reminders_service.get(reminder_id, list_context=reminder_list)
        if str(getattr(reminder, "list_id", "")) != str(getattr(reminder_list, "id", "")):
            raise ValueError("That reminder does not belong to the selected list.")
        reminders_service.delete(reminder)
        _cache_deleted_reminder(reminders_list_key(reminder_list), reminder_id)
        return {
            "ok": True,
            "state": "deleted",
            "reminderId": reminder_id,
            "revision": _cache_revision(reminders_list_key(reminder_list)),
        }
    except (ValueError, LookupError) as exc:
        return {"ok": False, "errorCode": "invalid_request", "error": str(exc)}
    except Exception as exc:
        return {"ok": False, **safe_error(exc)}


def move_reminder_section(request: dict[str, Any]) -> dict[str, Any]:
    if api is None:
        return {"ok": False, "errorCode": "authentication_required", "error": "Authenticate with Apple first."}
    failure_stage = "list_section_context"
    try:
        reminders_service = api.reminders
        list_key = str(request.get("listKey") or "")
        reminder_id = str(request.get("reminderId") or "").strip()
        if not reminder_id:
            raise ValueError("A reminder ID is required.")
        section_id = request.get("sectionID")
        if section_id is not None:
            section_id = str(section_id)
        lists, reminder_list, selected_ref = _load_list_section_context(
            reminders_service,
            list_key,
            str(request.get("requestId") or "")[:100],
        )
        failure_stage = "reminder_lookup"
        reminder = reminders_service.get(reminder_id, list_context=reminder_list)
        if str(getattr(reminder, "list_id", "")) != str(getattr(reminder_list, "id", "")):
            raise ValueError("That reminder does not belong to the selected list.")
        failure_stage = "section_mutation"
        _move_reminder_section(
            reminders_service,
            reminder_list,
            selected_ref,
            list_key,
            reminder_id,
            section_id,
        )
        failure_stage = "cache_update"
        cache = _REMINDER_LIST_CACHE.get(list_key)
        response = cache.get("response") if isinstance(cache, dict) else None
        cached_lists = response.get("lists", []) if isinstance(response, dict) else []
        cached_rows = cached_lists[0].get("reminders", []) if cached_lists and isinstance(cached_lists[0], dict) else []
        cached_reminder = next(
            (row for row in cached_rows if _normalized_record_identifier(row.get("id")) == _normalized_record_identifier(reminder_id)),
            None,
        )
        if cached_reminder is not None:
            section = next(
                (
                    item for item in selected_ref.get("sections", [])
                    if isinstance(item, dict)
                    and _normalized_record_identifier(item.get("id"))
                    == _normalized_record_identifier(section_id)
                ),
                None,
            ) if section_id is not None else None
            updated_cached_reminder = dict(cached_reminder)
            updated_cached_reminder.update({
                "sectionID": section_id,
                "sectionName": section.get("name") if section else None,
                "sectionOrder": section.get("order") if section else None,
            })
            _cache_mutated_reminder(list_key, updated_cached_reminder)
        return {
            "ok": True,
            "state": "updated",
            "listCount": len(lists),
            "reminderId": reminder_id,
            "revision": _cache_revision(list_key),
        }
    except (ValueError, LookupError) as exc:
        return {"ok": False, "errorCode": "invalid_request", "error": str(exc)}
    except SectionMutationError as exc:
        return _section_mutation_failure(exc)
    except Exception as exc:
        result = {"ok": False, **safe_error(exc)}
        result["failureStage"] = failure_stage
        return result


def handle(request: dict[str, Any]) -> dict[str, Any]:
    action = request.get("action")
    if action == "ping":
        return {
            "ok": True,
            "available": PYICLOUD_AVAILABLE,
            "pyicloudVersion": importlib.metadata.version("pyicloud") if PYICLOUD_AVAILABLE else None,
        }
    if action == "reset":
        global api, auth_mode, two_step_devices, two_step_device, _REMINDER_SYNC_CURSOR
        global _REMINDER_LIST_CATALOG, _REMINDER_LIST_CATALOG_DIRTY
        api = None
        auth_mode = None
        two_step_devices = []
        two_step_device = None
        _REMINDER_LIST_CACHE.clear()
        _REMINDER_AVAILABLE_LISTS.clear()
        _REMINDER_LIST_CATALOG = None
        _REMINDER_LIST_CATALOG_DIRTY = True
        _REMINDER_SYNC_CURSOR = None
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
    if action == "fetch_list":
        return fetch_list(request)
    if action == "fetch_task_lists":
        return fetch_task_lists(request)
    if action == "create_reminder":
        return create_reminder(request)
    if action == "update_reminder":
        return update_reminder(request)
    if action == "delete_reminder":
        return delete_reminder(request)
    if action == "move_reminder_section":
        return move_reminder_section(request)
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
            failure_stage=result.get("failureStage"),
            failure_detail=result.get("failureDetail"),
            error_detail=(
                str(result.get("error"))[:200]
                if result.get("errorCode") == "invalid_request" and result.get("error")
                else None
            ),
            apple_error_code=result.get("appleErrorCode"),
            http_status=result.get("httpStatus"),
            partial=result.get("partial"),
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
