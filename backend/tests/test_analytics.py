import json
from datetime import UTC, datetime

from app.analytics import build_archive_overview
from app.models import Classification, Post, Scan


def test_archive_overview_summarizes_history_and_latest_scan(db):
    posts = [
        Post(
            id="1",
            text="Hello #Archive @friend",
            language="en",
            content_type="post",
            posted_at=datetime(2020, 1, 6, 8, tzinfo=UTC),
            from_archive=True,
            media_json='[{"type":"photo"}]',
        ),
        Post(
            id="2",
            text="سلام #آرشیو",
            language="fa",
            content_type="reply",
            posted_at=datetime(2021, 2, 9, 18, tzinfo=UTC),
            from_archive=True,
        ),
    ]
    scan = Scan(prompt="politics", policy_json="{}", threshold=0.85, status="completed")
    db.add_all([*posts, scan])
    db.flush()
    db.add_all(
        [
            Classification(
                scan_id=scan.id,
                post_id="1",
                matches=True,
                confidence=0.9,
                selected=True,
                topics_json=json.dumps(["politics"]),
                cache_key="a" * 64,
            ),
            Classification(
                scan_id=scan.id,
                post_id="2",
                matches=False,
                confidence=0.2,
                selected=False,
                topics_json="[]",
                cache_key="b" * 64,
            ),
        ]
    )
    db.commit()

    result = build_archive_overview(db)
    assert result["summary"]["total"] == 2
    assert result["summary"]["media_posts"] == 1
    assert result["timeline"][0] == {"month": "2020-01", "count": 1}
    assert result["timeline"][-1] == {"month": "2021-02", "count": 1}
    assert result["hashtags"][0]["count"] == 1
    assert result["mentions"] == [{"name": "friend", "count": 1}]
    assert result["latest_scan"]["selected"] == 1
    assert result["latest_scan"]["topics"] == [{"key": "politics", "count": 1}]
