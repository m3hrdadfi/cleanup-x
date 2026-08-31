from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from sqlalchemy.orm import Session

from .config import get_settings
from .models import Post
from .schemas import AppRuntimeSettings
from .services import get_app_runtime_settings

ARCHIVE_CANDIDATE = re.compile(r"(?:^|/)(?:tweets(?:-part\d+)?|tweet)\.js$", re.IGNORECASE)


class ArchiveError(ValueError):
    pass


@dataclass
class ArchiveReport:
    imported: int = 0
    archive_only: int = 0
    duplicates: int = 0
    unresolved_reposts: int = 0
    ignored_files: int = 0

    def as_dict(self) -> dict[str, int]:
        return self.__dict__.copy()


def _safe_members(archive: zipfile.ZipFile, limits: AppRuntimeSettings | None = None) -> list[zipfile.ZipInfo]:
    settings = limits or get_settings()
    members = archive.infolist()
    if len(members) > settings.max_archive_files:
        raise ArchiveError("Archive contains too many files")
    total = 0
    for member in members:
        path = PurePosixPath(member.filename)
        if path.is_absolute() or ".." in path.parts:
            raise ArchiveError(f"Unsafe path in archive: {member.filename}")
        total += member.file_size
        if total > settings.max_archive_mb * 1024 * 1024:
            raise ArchiveError("Archive exceeds the configured decompressed size limit")
        if member.compress_size and member.file_size / member.compress_size > 500:
            raise ArchiveError("Archive contains a suspiciously compressed file")
    return members


def _parse_wrapped_json(raw: bytes) -> list[dict[str, Any]]:
    text = raw.decode("utf-8-sig", errors="strict").strip()
    if "=" in text and not text.startswith("["):
        text = text.split("=", 1)[1].strip()
    text = text.rstrip(";\n ")
    payload = json.loads(text)
    if not isinstance(payload, list):
        raise ArchiveError("Expected an array in archive post data")
    return [entry for entry in payload if isinstance(entry, dict)]


def _date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            parsed = datetime.strptime(value, fmt)  # noqa: DTZ007
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def _normalize(entry: dict[str, Any]) -> dict[str, Any] | None:
    tweet = entry.get("tweet", entry)
    if not isinstance(tweet, dict):
        return None
    post_id = str(tweet.get("id_str") or tweet.get("id") or "")
    if not post_id.isdigit():
        return None
    text = str(tweet.get("full_text") or tweet.get("text") or "")
    source_obj = (
        tweet.get("retweeted_status") if isinstance(tweet.get("retweeted_status"), dict) else {}
    )
    source_id = tweet.get("retweeted_status_id_str") or source_obj.get("id_str")
    quoted_id = tweet.get("quoted_status_id_str")
    if source_id or text.startswith("RT @"):
        content_type = "repost"
    elif quoted_id:
        content_type = "quote"
    elif tweet.get("in_reply_to_status_id_str"):
        content_type = "reply"
    else:
        content_type = "post"
    media = tweet.get("extended_entities", {}).get("media", [])
    if not isinstance(media, list):
        media = []
    return {
        "id": post_id,
        "text": text,
        "source_text": source_obj.get("full_text") or source_obj.get("text"),
        "language": tweet.get("lang"),
        "posted_at": _date(tweet.get("created_at")),
        "content_type": content_type,
        "source_post_id": str(source_id) if source_id else None,
        "quoted_post_id": str(quoted_id) if quoted_id else None,
        "media_json": json.dumps(media, ensure_ascii=False),
        "raw_json": json.dumps(tweet, ensure_ascii=False),
    }


def import_x_archive(path: Path, db: Session) -> ArchiveReport:
    report = ArchiveReport()
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise ArchiveError("The uploaded file is not a valid ZIP archive") from exc
    with archive:
        members = _safe_members(archive, get_app_runtime_settings(db))
        candidates = [m for m in members if ARCHIVE_CANDIDATE.search(m.filename)]
        report.ignored_files = len(members) - len(candidates)
        if not candidates:
            raise ArchiveError("No supported tweets.js files were found in this archive")
        for member in candidates:
            for entry in _parse_wrapped_json(archive.read(member)):
                data = _normalize(entry)
                if not data:
                    continue
                existing = db.get(Post, data["id"])
                if existing:
                    existing.from_archive = True
                    for key, value in data.items():
                        if key != "id" and value not in (None, "", "[]", "{}"):
                            setattr(existing, key, value)
                    report.duplicates += 1
                else:
                    db.add(Post(**data, from_archive=True))
                    report.archive_only += 1
                report.imported += 1
                if data["content_type"] == "repost" and not data["source_post_id"]:
                    report.unresolved_reposts += 1
        db.commit()
    return report
