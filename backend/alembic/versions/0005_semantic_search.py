"""Local, derived embedding cache and restart-safe indexing checkpoints."""

import sqlalchemy as sa
from alembic import op

revision = "0005_semantic_search"
down_revision = "0004_inventory_removals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = sa.inspect(op.get_bind()).get_table_names()
    if "post_embeddings" not in existing:
        op.create_table(
            "post_embeddings",
            sa.Column("profile", sa.String(64), primary_key=True),
            sa.Column("post_id", sa.String(32), sa.ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("vector_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if "embedding_jobs" not in existing:
        op.create_table(
            "embedding_jobs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("request_key", sa.String(128), unique=True, nullable=False),
            sa.Column("profile", sa.String(64), nullable=False),
            sa.Column("items_json", sa.Text(), nullable=False),
            sa.Column("status", sa.String(24), nullable=False),
            sa.Column("total", sa.Integer(), nullable=False),
            sa.Column("processed", sa.Integer(), nullable=False),
            sa.Column("indexed", sa.Integer(), nullable=False),
            sa.Column("skipped", sa.Integer(), nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_embedding_jobs_profile", "embedding_jobs", ["profile"])


def downgrade() -> None:
    op.drop_table("embedding_jobs")
    op.drop_table("post_embeddings")
