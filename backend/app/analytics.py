from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .inventory import visible_results, visible_scans
from .models import Classification, DeletionJob, Post, Scan

HASHTAG = re.compile(r"#([^\s#@.,!?;:()\[\]{}]+)", re.UNICODE)
MENTION = re.compile(r"@([A-Za-z0-9_]{1,15})")
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _series(counter: Counter[str], key: str = "key") -> list[dict[str, Any]]:
    return [{key: name, "count": count} for name, count in counter.most_common()]


def _month_range(start: datetime, end: datetime) -> list[str]:
    year, month = start.year, start.month
    values: list[str] = []
    while (year, month) <= (end.year, end.month):
        values.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return values


def build_archive_overview(db: Session) -> dict[str, Any]:
    posts = list(
        db.scalars(
            select(Post).where(Post.from_archive.is_(True)).order_by(Post.posted_at.asc())
        ).all()
    )
    dated = [post for post in posts if post.posted_at]
    active = [post for post in posts if post.deleted_at is None]
    first = dated[0].posted_at if dated else None
    last = dated[-1].posted_at if dated else None

    content_types: Counter[str] = Counter(post.content_type for post in posts)
    languages: Counter[str] = Counter(post.language or "unknown" for post in posts)
    months: Counter[str] = Counter(
        post.posted_at.strftime("%Y-%m") for post in dated if post.posted_at
    )
    years: Counter[str] = Counter(str(post.posted_at.year) for post in dated if post.posted_at)
    dates: Counter[str] = Counter(
        post.posted_at.date().isoformat() for post in dated if post.posted_at
    )
    weekdays: Counter[int] = Counter(post.posted_at.weekday() for post in dated if post.posted_at)
    hours: Counter[int] = Counter(post.posted_at.hour for post in dated if post.posted_at)
    hashtags: Counter[str] = Counter()
    mentions: Counter[str] = Counter()
    media_posts = 0
    characters = 0
    for post in posts:
        text = post.source_text or post.text
        characters += len(text)
        hashtags.update(tag.casefold() for tag in HASHTAG.findall(text))
        mentions.update(name.casefold() for name in MENTION.findall(text))
        try:
            media = json.loads(post.media_json)
            media_posts += int(isinstance(media, list) and bool(media))
        except json.JSONDecodeError:
            pass

    timeline = (
        [{"month": month, "count": months[month]} for month in _month_range(first, last)]
        if first and last
        else []
    )
    total = len(posts)
    active_days = len(dates)
    span_days = (last.date() - first.date()).days + 1 if first and last else 0

    latest_scan = db.scalar(
        select(Scan).where(Scan.status == "completed", visible_scans()).order_by(Scan.created_at.desc())
    )
    scan_payload: dict[str, Any] | None = None
    if latest_scan:
        results = list(
            db.scalars(
                select(Classification)
                .join(Post, Post.id == Classification.post_id)
                .where(
                    Classification.scan_id == latest_scan.id,
                    Post.from_archive.is_(True),
                    visible_results(),
                )
            ).all()
        )
        topics: Counter[str] = Counter()
        for result in results:
            try:
                topics.update(str(topic) for topic in json.loads(result.topics_json))
            except json.JSONDecodeError:
                pass
        selected = sum(result.selected for result in results)
        scan_payload = {
            "id": latest_scan.id,
            "prompt": latest_scan.prompt,
            "threshold": latest_scan.threshold,
            "classified": len(results),
            "selected": selected,
            "selection_rate": selected / len(results) if results else 0,
            "failed": sum(result.status == "failed" for result in results),
            "confidence": [
                {
                    "key": "low",
                    "count": sum(result.confidence < 0.5 for result in results),
                },
                {
                    "key": "uncertain",
                    "count": sum(
                        0.5 <= result.confidence < latest_scan.threshold for result in results
                    ),
                },
                {
                    "key": "high",
                    "count": sum(result.confidence >= latest_scan.threshold for result in results),
                },
            ],
            "topics": _series(topics)[:8],
        }

    deletion_jobs = db.scalar(select(func.count()).select_from(DeletionJob)) or 0
    unresolved_reposts = sum(
        post.content_type == "repost" and post.source_post_id is None and post.deleted_at is None
        for post in posts
    )
    return {
        "summary": {
            "total": total,
            "remaining": len(active),
            "deleted": total - len(active),
            "first_post": first,
            "last_post": last,
            "span_days": span_days,
            "active_days": active_days,
            "average_per_active_day": total / active_days if active_days else 0,
            "average_characters": characters / total if total else 0,
            "media_posts": media_posts,
        },
        "coverage": {
            "archive_only": sum(post.from_archive and not post.from_api for post in posts),
            "archive_and_api": sum(post.from_archive and post.from_api for post in posts),
        },
        "content_types": _series(content_types),
        "languages": _series(languages)[:8],
        "timeline": timeline,
        "years": sorted(_series(years, "year"), key=lambda item: item["year"]),
        "weekdays": [
            {"day": name, "count": weekdays[index]} for index, name in enumerate(WEEKDAYS)
        ],
        "hours": [{"hour": hour, "count": hours[hour]} for hour in range(24)],
        "top_dates": _series(dates, "date")[:5],
        "hashtags": _series(hashtags, "name")[:12],
        "mentions": _series(mentions, "name")[:12],
        "latest_scan": scan_payload,
        "cleanup": {
            "deletion_jobs": deletion_jobs,
            "unresolved_reposts": unresolved_reposts,
        },
    }
