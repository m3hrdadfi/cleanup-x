from pathlib import Path
from types import SimpleNamespace

import pytest
from app import demo_seed, main, x_client
from app.demo_seed import create_demo_database
from app.models import AppSetting, Classification, Post, PostEmbedding, Scan, XConnection
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session


def test_demo_seed_is_synthetic_and_contains_useful_sessions(tmp_path: Path) -> None:
    target = tmp_path / "cleanup-demo.db"

    path, backup, counts = create_demo_database(target)

    assert path == target
    assert backup is None
    assert counts == {"posts": 240, "scans": 3, "deletion_items": 6}
    engine = create_engine(f"sqlite:///{target}")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Post)) == 240
        assert db.scalar(select(func.count()).select_from(Scan)) == 3
        assert db.scalar(select(func.count()).select_from(Classification)) == 440
        assert db.scalar(select(func.count()).select_from(XConnection)) == 0
        assert db.scalar(select(func.count()).select_from(AppSetting)) == 0
        assert db.scalar(select(func.count()).select_from(PostEmbedding)) == 0
        posts = list(db.scalars(select(Post)).all())
        assert all(post.id.startswith("demo-post-") for post in posts)
        assert all('"demo": true' in post.raw_json for post in posts)
        assert {post.language for post in posts} == {"en", "fa", "sv", "nb", "da", "fi"}
    engine.dispose()


def test_demo_seed_replacement_creates_backup(tmp_path: Path) -> None:
    target = tmp_path / "showcase-demo.db"
    create_demo_database(target)

    _, backup, _ = create_demo_database(target, replace=True)

    assert backup is not None
    assert backup.exists()
    assert target.exists()


def test_demo_seed_refuses_configured_database(monkeypatch, tmp_path: Path) -> None:
    target = tmp_path / "live-demo.db"
    monkeypatch.setattr(demo_seed, "_live_database_path", lambda: target.resolve())

    with pytest.raises(SystemExit, match="never overwritten"):
        create_demo_database(target)


def test_demo_mode_blocks_route_and_low_level_x(monkeypatch) -> None:
    demo = SimpleNamespace(demo_mode=True)
    monkeypatch.setattr(main, "get_settings", lambda: demo)
    monkeypatch.setattr(x_client, "get_settings", lambda: demo)

    with pytest.raises(Exception) as route_error:
        main.require_live_x()
    assert getattr(route_error.value, "status_code", None) == 409
    with pytest.raises(x_client.XAuthError, match="disabled in demo mode"):
        x_client._require_live_x()
