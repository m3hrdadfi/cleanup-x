"""Create a deterministic, synthetic Cleanup X database for screenshots and demos.

This command intentionally refuses to write to the configured live database.  It does
not copy settings, credentials, tokens, archive text, or embeddings from another file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from .config import ROOT, get_settings
from .database import Base
from .models import (
    AuditEvent,
    Classification,
    DeletionItem,
    DeletionJob,
    ImportJob,
    Post,
    Scan,
)

SEED = 20260831
DEFAULT_PATH = ROOT / "data" / "cleanup-x-demo.db"

SAMPLES: dict[str, list[tuple[str, str, str]]] = {
    "en": [
        ("technology", "Built a tiny local search prototype today. Private data should stay private. #LocalAI", "post"),
        ("design", "A calm dashboard needs hierarchy, useful density, and fewer decorative boxes. #DesignSystems", "post"),
        ("travel", "Morning train notes: quiet lakes, red cabins, and enough coffee for the whole route. #NordicTravel", "post"),
        ("books", "Finished a thoughtful book about memory, archives, and the stories we choose to keep. #Reading", "quote"),
        ("food", "Testing a weeknight soup recipe with saffron, lemon, and plenty of herbs. #HomeCooking", "reply"),
        ("civic", "A fictional town-hall demo: publish the budget as accessible open data. #CivicTech", "repost"),
    ],
    "fa": [
        ("technology", "امروز یک نمونهٔ جست‌وجوی محلی ساختم؛ داده‌های خصوصی باید خصوصی بمانند. #هوش_مصنوعی", "post"),
        ("design", "یک داشبورد آرام به سلسله‌مراتب روشن و جزئیات کاربردی نیاز دارد. #طراحی", "post"),
        ("travel", "یادداشت سفر: دریاچهٔ آرام، قطار صبحگاهی و یک فنجان قهوه. #سفر", "post"),
        ("books", "کتابی دربارهٔ حافظه، آرشیو و داستان‌هایی که نگه می‌داریم تمام کردم. #کتاب", "quote"),
        ("food", "امشب سوپ ساده‌ای با زعفران، لیمو و سبزی تازه درست کردم. #آشپزی", "reply"),
        ("civic", "نمونهٔ ساختگی شورای شهر: بودجه باید به شکل دادهٔ باز منتشر شود. #فناوری_مدنی", "repost"),
    ],
    "sv": [
        ("technology", "Byggde en liten lokal sökprototyp i dag. Privat data ska förbli privat. #teknik", "post"),
        ("design", "En lugn instrumentpanel behöver tydlig hierarki och användbar täthet. #design", "post"),
        ("travel", "Morgontåg, stilla sjöar och röda stugor längs vägen. #resa", "post"),
        ("food", "Testar en enkel vardagssoppa med citron och färska örter. #mat", "reply"),
    ],
    "nb": [
        ("technology", "Bygget en liten lokal søkeprototype i dag. Private data bør forbli private. #teknologi", "post"),
        ("travel", "Morgentog, stille innsjøer og røde hytter langs veien. #reise", "post"),
    ],
    "da": [
        ("design", "Et roligt dashboard kræver tydeligt hierarki og nyttige detaljer. #design", "post"),
        ("food", "Prøver en enkel hverdagssuppe med citron og friske urter. #mad", "reply"),
    ],
    "fi": [
        ("technology", "Rakensin tänään pienen paikallisen hakuprototyypin. Yksityinen data pysyy yksityisenä. #teknologia", "post"),
        ("travel", "Aamujuna, hiljaiset järvet ja punaiset mökit matkan varrella. #matka", "post"),
    ],
}


def _stable_id(kind: str, value: int | str) -> str:
    return str(uuid5(NAMESPACE_URL, f"cleanup-x-demo:{kind}:{value}"))


def _live_database_path() -> Path | None:
    url = get_settings().database_url
    if not url.startswith("sqlite:///"):
        return None
    raw = Path(url.removeprefix("sqlite:///"))
    return (Path.cwd() / raw).resolve() if not raw.is_absolute() else raw.resolve()


def _validate_target(target: Path) -> Path:
    resolved = target.expanduser().resolve()
    if "demo" not in resolved.name.casefold():
        raise SystemExit("Refusing target: the demo database filename must contain 'demo'.")
    live = _live_database_path()
    if live and resolved == live:
        raise SystemExit("Refusing target: the configured application database is never overwritten.")
    return resolved


def _posts() -> list[Post]:
    rng = random.Random(SEED)
    languages = ["en"] * 42 + ["fa"] * 34 + ["sv"] * 9 + ["nb"] * 6 + ["da"] * 5 + ["fi"] * 4
    start = datetime(2021, 1, 12, 8, 0, tzinfo=UTC)
    posts: list[Post] = []
    for index in range(240):
        language = rng.choice(languages)
        topic, base_text, content_type = rng.choice(SAMPLES[language])
        posted_at = start + timedelta(days=index * 8 + rng.randint(0, 5), hours=rng.randint(0, 15))
        post_id = f"demo-post-{index + 1:05d}"
        suffix = f" · demo note {index + 1}" if language == "en" else ""
        source_id = f"demo-source-{index + 1:05d}" if content_type == "repost" and index % 5 else None
        posts.append(
            Post(
                id=post_id,
                text=base_text + suffix,
                source_text=base_text if content_type == "repost" else None,
                language=language,
                posted_at=posted_at,
                content_type=content_type,
                source_post_id=source_id,
                quoted_post_id=f"demo-quote-{index + 1:05d}" if content_type == "quote" else None,
                media_json=json.dumps(
                    [{"type": "photo", "demo": True}] if index % 7 == 0 else []
                ),
                raw_json=json.dumps({"demo": True, "topic": topic}),
                from_archive=True,
                from_api=False,
                accessible=True,
            )
        )
    return posts


def _add_scan(
    db: Session,
    posts: list[Post],
    *,
    prompt: str,
    topic: str,
    created_at: datetime,
) -> Scan:
    scan = Scan(
        id=_stable_id("scan", topic),
        prompt=prompt,
        policy_json=json.dumps(
            {
                "target_topic": topic,
                "included_languages": ["en", "fa", "sv", "nb", "da", "fi"],
                "included_content_types": ["post", "reply", "quote", "repost"],
                "positive_indicators": [topic],
                "exclusions": ["incidental mentions"],
                "ambiguity_guidance": "Demo classifications are deterministic synthetic examples.",
            }
        ),
        threshold=0.85,
        content_types_json=json.dumps(["post", "reply", "quote", "repost"]),
        languages_json=json.dumps(["en", "fa", "sv", "nb", "da", "fi"]),
        status="completed",
        total=len(posts),
        processed=len(posts),
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(scan)
    db.flush()
    for index, post in enumerate(posts):
        post_topic = json.loads(post.raw_json)["topic"]
        matches = post_topic == topic
        confidence = 0.94 if matches else 0.12 + (index % 5) * 0.03
        db.add(
            Classification(
                scan_id=scan.id,
                post_id=post.id,
                matches=matches,
                confidence=confidence,
                detected_language=post.language or "unknown",
                topics_json=json.dumps([post_topic]),
                reason_en=(
                    f"The synthetic post is primarily about {topic}."
                    if matches
                    else f"The synthetic post is about {post_topic}, not {topic}."
                ),
                reason_fa=(
                    f"این نوشتهٔ آزمایشی دربارهٔ {topic} است."
                    if matches
                    else f"این نوشتهٔ آزمایشی دربارهٔ {post_topic} است، نه {topic}."
                ),
                selected=matches and index % 4 != 0,
                status="classified",
                cache_key=hashlib.sha256(f"demo:{topic}:{post.id}".encode()).hexdigest(),
                created_at=created_at,
                updated_at=created_at,
            )
        )
    return scan


def seed_database(path: Path) -> dict[str, int]:
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        posts = _posts()
        db.add_all(posts)
        now = datetime(2026, 8, 31, 10, 0, tzinfo=UTC)
        report = {
            "imported": len(posts),
            "archive_only": len(posts),
            "duplicates": 0,
            "unresolved_reposts": sum(
                post.content_type == "repost" and post.source_post_id is None for post in posts
            ),
            "ignored_files": 0,
            "synthetic_demo": True,
        }
        db.add(
            ImportJob(
                id=_stable_id("import", "archive"),
                filename="synthetic-demo-archive.zip",
                status="completed",
                report_json=json.dumps(report),
                created_at=now - timedelta(days=14),
                updated_at=now - timedelta(days=14),
            )
        )
        scans = [
            _add_scan(
                db,
                posts[:80],
                prompt="Find posts about technology and local-first software",
                topic="technology",
                created_at=now - timedelta(days=10),
            ),
            _add_scan(
                db,
                posts[60:180],
                prompt="Find travel memories in every available language",
                topic="travel",
                created_at=now - timedelta(days=5),
            ),
            _add_scan(
                db,
                posts,
                prompt="Find posts about design and visual systems",
                topic="design",
                created_at=now - timedelta(hours=3),
            ),
        ]
        demo_deleted = [post for post in posts if json.loads(post.raw_json)["topic"] == "technology"][:6]
        for post in demo_deleted:
            post.deleted_at = now - timedelta(days=8)
            post.accessible = False
        manifest_payload = {
            "version": 1,
            "synthetic_demo": True,
            "scan_id": scans[0].id,
            "items": [{"post_id": post.id} for post in demo_deleted],
        }
        manifest = json.dumps(manifest_payload, sort_keys=True)
        deletion = DeletionJob(
            id=_stable_id("deletion", "completed"),
            scan_id=scans[0].id,
            status="completed",
            manifest_json=manifest,
            manifest_sha256=hashlib.sha256(manifest.encode()).hexdigest(),
            total=len(demo_deleted),
            processed=len(demo_deleted),
            succeeded=len(demo_deleted),
            failed=0,
            created_at=now - timedelta(days=8),
            updated_at=now - timedelta(days=8),
        )
        db.add(deletion)
        db.flush()
        for post in demo_deleted:
            db.add(
                DeletionItem(
                    job_id=deletion.id,
                    post_id=post.id,
                    status="deleted",
                    attempts=1,
                    created_at=now - timedelta(days=8),
                    updated_at=now - timedelta(days=8),
                )
            )
        db.add_all(
            [
                AuditEvent(
                    event_type="demo.seeded",
                    entity_type="demo_dataset",
                    entity_id="synthetic-v1",
                    details_json=json.dumps({"posts": len(posts), "synthetic": True}),
                    created_at=now - timedelta(days=14),
                ),
                AuditEvent(
                    event_type="deletion.completed",
                    entity_type="deletion_job",
                    entity_id=deletion.id,
                    details_json=json.dumps(
                        {"succeeded": len(demo_deleted), "synthetic_demo": True}
                    ),
                    created_at=now - timedelta(days=8),
                ),
            ]
        )
        db.commit()
    engine.dispose()
    return {"posts": len(posts), "scans": len(scans), "deletion_items": len(demo_deleted)}


def create_demo_database(target: Path, replace: bool = False) -> tuple[Path, Path | None, dict[str, int]]:
    target = _validate_target(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and not replace:
        raise SystemExit(f"Demo database already exists: {target}\nUse --replace to back it up and reseed it.")
    temporary = target.with_name(f".{target.name}.{os.getpid()}.new")
    temporary.unlink(missing_ok=True)
    backup: Path | None = None
    try:
        counts = seed_database(temporary)
        if target.exists():
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            backup = target.with_name(f"{target.stem}.{stamp}.backup{target.suffix}")
            shutil.copy2(target, backup)
            for suffix in ("-wal", "-shm"):
                Path(f"{target}{suffix}").unlink(missing_ok=True)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target, backup, counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_PATH)
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Back up and replace an existing demo database; never replaces the configured live DB.",
    )
    args = parser.parse_args()
    path, backup, counts = create_demo_database(args.database, args.replace)
    print(f"Created synthetic demo database: {path}")
    print(f"Seeded {counts['posts']} posts, {counts['scans']} scans, and {counts['deletion_items']} simulated deletion outcomes.")
    if backup:
        print(f"Previous demo database backup: {backup}")
    print("Run the API with APP_DEMO_MODE=true and APP_DATABASE_URL pointing to this file.")


if __name__ == "__main__":
    main()
