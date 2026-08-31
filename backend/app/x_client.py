from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Post, XConnection
from .security import decrypt, encrypt
from .x_settings import XCredentials, get_x_settings

X_API = "https://api.x.com"


class XAuthError(RuntimeError):
    pass


class XAPIError(RuntimeError):
    pass


class XRateLimitError(RuntimeError):
    def __init__(self, resume_at: datetime):
        super().__init__("X rate limit reached")
        self.resume_at = resume_at


def _require_live_x() -> None:
    if get_settings().demo_mode:
        raise XAuthError("X network access is disabled in demo mode")


@dataclass
class DeleteResult:
    outcome: str
    error: str | None = None
    resume_at: datetime | None = None


def _auth_header(credentials: XCredentials | None = None) -> dict[str, str]:
    settings = credentials or get_settings()
    if not settings.x_client_secret:
        return {}
    encoded = base64.b64encode(
        f"{settings.x_client_id}:{settings.x_client_secret}".encode()
    ).decode()
    return {"Authorization": f"Basic {encoded}"}


async def exchange_code(code: str, verifier: str, credentials: XCredentials | None = None) -> dict[str, Any]:
    _require_live_x()
    settings = credentials or get_settings()
    data = {
        "code": code,
        "grant_type": "authorization_code",
        "client_id": settings.x_client_id,
        "redirect_uri": settings.x_callback_url,
        "code_verifier": verifier,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{X_API}/2/oauth2/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded", **_auth_header(credentials)},
        )
        response.raise_for_status()
        token = response.json()
    token["expires_at"] = (
        datetime.now(UTC) + timedelta(seconds=token.get("expires_in", 7200))
    ).isoformat()
    return token


async def refresh_token(token: dict[str, Any], credentials: XCredentials | None = None) -> dict[str, Any]:
    _require_live_x()
    settings = credentials or get_settings()
    if not token.get("refresh_token"):
        raise XAuthError("X session expired and no refresh token is available")
    data = {
        "refresh_token": token["refresh_token"],
        "grant_type": "refresh_token",
        "client_id": settings.x_client_id,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{X_API}/2/oauth2/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded", **_auth_header(credentials)},
        )
        if response.status_code >= 400:
            raise XAuthError("X authorization must be renewed")
        refreshed = response.json()
    refreshed.setdefault("refresh_token", token["refresh_token"])
    refreshed["expires_at"] = (
        datetime.now(UTC) + timedelta(seconds=refreshed.get("expires_in", 7200))
    ).isoformat()
    return refreshed


async def get_connection_token(db: Session) -> tuple[XConnection, dict[str, Any]]:
    _require_live_x()
    connection = db.scalar(select(XConnection).order_by(XConnection.created_at.desc()))
    if not connection:
        raise XAuthError("No X account is connected")
    token = json.loads(decrypt(connection.token_encrypted))
    expiry = token.get("expires_at")
    if expiry and datetime.fromisoformat(expiry) <= datetime.now(UTC) + timedelta(seconds=60):
        token = await refresh_token(token, get_x_settings(db))
        connection.token_encrypted = encrypt(json.dumps(token))
        db.commit()
    return connection, token


async def connect_identity(db: Session, token: dict[str, Any]) -> XConnection:
    _require_live_x()
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            f"{X_API}/2/users/me",
            params={"user.fields": "name,username"},
            headers={"Authorization": f"Bearer {token['access_token']}"},
        )
        response.raise_for_status()
        user = response.json()["data"]
    connection = db.scalar(select(XConnection).where(XConnection.x_user_id == str(user["id"])))
    if not connection:
        connection = XConnection(
            x_user_id=str(user["id"]),
            username=user["username"],
            name=user.get("name", ""),
            token_encrypted="",
        )
        db.add(connection)
    connection.username = user["username"]
    connection.name = user.get("name", "")
    connection.token_encrypted = encrypt(json.dumps(token))
    db.commit()
    db.refresh(connection)
    return connection


def _normalize_api_post(
    item: dict[str, Any],
    included_tweets: dict[str, dict[str, Any]],
    included_media: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    refs = item.get("referenced_tweets", []) or []
    ref_by_type = {ref.get("type"): str(ref.get("id")) for ref in refs if ref.get("id")}
    if "retweeted" in ref_by_type:
        content_type = "repost"
        source_id = ref_by_type["retweeted"]
    elif "quoted" in ref_by_type:
        content_type = "quote"
        source_id = None
    elif "replied_to" in ref_by_type:
        content_type = "reply"
        source_id = None
    else:
        content_type = "post"
        source_id = None
    source = included_tweets.get(source_id or "", {})
    media_keys = item.get("attachments", {}).get("media_keys", [])
    media = [included_media[key] for key in media_keys if key in included_media]
    posted_at = item.get("created_at")
    return {
        "id": str(item["id"]),
        "text": item.get("text", ""),
        "source_text": source.get("text"),
        "language": item.get("lang"),
        "posted_at": datetime.fromisoformat(posted_at) if posted_at else None,
        "content_type": content_type,
        "source_post_id": source_id,
        "quoted_post_id": ref_by_type.get("quoted"),
        "media_json": json.dumps(media),
        "raw_json": json.dumps(item, ensure_ascii=False),
    }


async def sync_posts(db: Session) -> dict[str, int]:
    connection, token = await get_connection_token(db)
    headers = {"Authorization": f"Bearer {token['access_token']}"}
    params: dict[str, str | int] = {
        "max_results": 100,
        "tweet.fields": "created_at,lang,entities,attachments,referenced_tweets",
        "expansions": "referenced_tweets.id,attachments.media_keys",
        "media.fields": "type,url,preview_image_url",
    }
    imported = duplicates = 0
    seen = 0
    async with httpx.AsyncClient(timeout=60) as client:
        while seen < 3200:
            response = await client.get(
                f"{X_API}/2/users/{connection.x_user_id}/tweets", params=params, headers=headers
            )
            if response.status_code == 401:
                token = await refresh_token(token, get_x_settings(db))
                connection.token_encrypted = encrypt(json.dumps(token))
                db.commit()
                headers["Authorization"] = f"Bearer {token['access_token']}"
                continue
            response.raise_for_status()
            payload = response.json()
            includes = payload.get("includes", {})
            included_tweets = {str(p["id"]): p for p in includes.get("tweets", [])}
            included_media = {str(media["media_key"]): media for media in includes.get("media", [])}
            for item in payload.get("data", []):
                data = _normalize_api_post(item, included_tweets, included_media)
                existing = db.get(Post, data["id"])
                if existing:
                    existing.from_api = True
                    existing.accessible = True
                    for key, value in data.items():
                        if key != "id" and value not in (None, "", "[]", "{}"):
                            setattr(existing, key, value)
                    duplicates += 1
                else:
                    db.add(Post(**data, from_api=True, accessible=True))
                    imported += 1
                seen += 1
            db.commit()
            next_token = payload.get("meta", {}).get("next_token")
            if not next_token or seen >= 3200:
                break
            params["pagination_token"] = next_token
    return {
        "imported": imported,
        "duplicates": duplicates,
        "api_records": seen,
        "timeline_limit": 3200,
    }


async def resolve_repost_sources(db: Session, post_ids: list[str]) -> dict[str, str]:
    """Resolve archive repost IDs to the source IDs required by the unrepost endpoint."""
    connection, token = await get_connection_token(db)
    headers = {"Authorization": f"Bearer {token['access_token']}"}
    params = {"ids": ",".join(post_ids), "tweet.fields": "referenced_tweets"}
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(f"{X_API}/2/tweets", params=params, headers=headers)
        if response.status_code == 401:
            token = await refresh_token(token, get_x_settings(db))
            connection.token_encrypted = encrypt(json.dumps(token))
            db.commit()
            headers["Authorization"] = f"Bearer {token['access_token']}"
            response = await client.get(f"{X_API}/2/tweets", params=params, headers=headers)
    if response.status_code == 401:
        raise XAuthError("X authorization must be renewed")
    if response.status_code == 429:
        reset = response.headers.get("x-rate-limit-reset")
        resume_at = (
            datetime.fromtimestamp(int(reset), UTC)
            if reset and reset.isdigit()
            else datetime.now(UTC) + timedelta(minutes=15)
        )
        raise XRateLimitError(resume_at)
    response.raise_for_status()
    resolved: dict[str, str] = {}
    for item in response.json().get("data", []):
        reference = next(
            (
                ref
                for ref in item.get("referenced_tweets", [])
                if ref.get("type") == "retweeted" and ref.get("id")
            ),
            None,
        )
        if reference:
            resolved[str(item["id"])] = str(reference["id"])
    return resolved


async def delete_post(db: Session, post: Post) -> DeleteResult:
    connection, token = await get_connection_token(db)
    if post.content_type == "repost":
        if not post.source_post_id:
            return DeleteResult("unresolved", "Repost source ID is unavailable")
        url = f"{X_API}/2/users/{connection.x_user_id}/retweets/{post.source_post_id}"
    else:
        url = f"{X_API}/2/tweets/{post.id}"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.delete(
            url, headers={"Authorization": f"Bearer {token['access_token']}"}
        )
    if response.status_code in (200, 201):
        return DeleteResult("deleted")
    if response.status_code == 404:
        return DeleteResult("already_absent")
    if response.status_code == 401:
        return DeleteResult("reauth_required", "X authorization expired")
    if response.status_code == 429:
        reset = response.headers.get("x-rate-limit-reset")
        resume = (
            datetime.fromtimestamp(int(reset), UTC)
            if reset and reset.isdigit()
            else datetime.now(UTC) + timedelta(minutes=15)
        )
        return DeleteResult("rate_limited", "X rate limit reached", resume)
    detail = response.text[:500]
    return DeleteResult("failed", f"X returned {response.status_code}: {detail}")
