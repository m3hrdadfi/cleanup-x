import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from app.models import Post, XConnection
from app.security import encrypt
from app.x_client import delete_post, resolve_repost_sources


def connected(db):
    token = {
        "access_token": "token",
        "refresh_token": "refresh",
        "expires_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
    }
    db.add(
        XConnection(
            x_user_id="42",
            username="owner",
            name="Owner",
            token_encrypted=encrypt(json.dumps(token)),
        )
    )
    db.commit()


@pytest.mark.asyncio
@respx.mock
async def test_authored_post_uses_delete_endpoint(db):
    connected(db)
    post = Post(id="100", text="text", content_type="post")
    db.add(post)
    db.commit()
    route = respx.delete("https://api.x.com/2/tweets/100").mock(
        return_value=httpx.Response(200, json={"data": {"deleted": True}})
    )
    result = await delete_post(db, post)
    assert result.outcome == "deleted" and route.called


@pytest.mark.asyncio
@respx.mock
async def test_repost_uses_source_id(db):
    connected(db)
    post = Post(id="101", text="RT", content_type="repost", source_post_id="55")
    db.add(post)
    db.commit()
    route = respx.delete("https://api.x.com/2/users/42/retweets/55").mock(
        return_value=httpx.Response(200, json={"data": {"retweeted": False}})
    )
    result = await delete_post(db, post)
    assert result.outcome == "deleted" and route.called


@pytest.mark.asyncio
async def test_unresolved_repost_never_calls_x(db):
    connected(db)
    post = Post(id="102", text="RT", content_type="repost")
    db.add(post)
    db.commit()
    result = await delete_post(db, post)
    assert result.outcome == "unresolved"


@pytest.mark.asyncio
@respx.mock
async def test_repost_lookup_resolves_source_reference(db):
    connected(db)
    route = respx.get("https://api.x.com/2/tweets").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "102",
                        "text": "RT",
                        "referenced_tweets": [{"type": "retweeted", "id": "55"}],
                    }
                ]
            },
        )
    )
    resolved = await resolve_repost_sources(db, ["102"])
    assert resolved == {"102": "55"}
    assert route.called
