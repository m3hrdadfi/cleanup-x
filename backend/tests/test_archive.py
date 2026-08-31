import json
import zipfile

import pytest
from app.archive import ArchiveError, import_x_archive
from app.models import Post


def wrapped(items):
    return f"window.YTD.tweets.part0 = {json.dumps(items, ensure_ascii=False)};"


def test_imports_mixed_archive_and_deduplicates(tmp_path, db):
    archive = tmp_path / "x.zip"
    records = [
        {
            "tweet": {
                "id_str": "100",
                "full_text": "Election policy",
                "lang": "en",
                "created_at": "Mon Jan 01 12:00:00 +0000 2024",
            }
        },
        {
            "tweet": {
                "id_str": "101",
                "full_text": "یک نوشته سیاسی",
                "lang": "fa",
                "in_reply_to_status_id_str": "99",
            }
        },
        {
            "tweet": {
                "id_str": "102",
                "full_text": "RT @someone: news",
                "lang": "en",
                "retweeted_status_id_str": "55",
            }
        },
        {"tweet": {"id_str": "103", "full_text": "RT @missing: news", "lang": "en"}},
    ]
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("data/tweets.js", wrapped(records))
        handle.writestr("data/account.js", "[]")
    report = import_x_archive(archive, db)
    assert report.imported == 4
    assert report.archive_only == 4
    assert report.unresolved_reposts == 1
    assert db.get(Post, "101").content_type == "reply"
    assert db.get(Post, "102").source_post_id == "55"

    again = import_x_archive(archive, db)
    assert again.duplicates == 4
    assert db.query(Post).count() == 4


def test_rejects_zip_slip(tmp_path, db):
    archive = tmp_path / "hostile.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("../data/tweets.js", wrapped([]))
    with pytest.raises(ArchiveError, match="Unsafe path"):
        import_x_archive(archive, db)


def test_rejects_missing_tweet_data(tmp_path, db):
    archive = tmp_path / "empty.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("data/account.js", "[]")
    with pytest.raises(ArchiveError, match="No supported"):
        import_x_archive(archive, db)
