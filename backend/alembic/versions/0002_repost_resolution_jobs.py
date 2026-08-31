"""Persist repost source-resolution jobs."""

import sqlalchemy as sa
from alembic import op

revision = "0002_repost_resolution_jobs"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "repost_resolution_jobs" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "repost_resolution_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("deletion_job_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("processed", sa.Integer(), nullable=False),
        sa.Column("resolved", sa.Integer(), nullable=False),
        sa.Column("failed", sa.Integer(), nullable=False),
        sa.Column("resume_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["deletion_job_id"], ["deletion_jobs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_repost_resolution_jobs_deletion_job_id"),
        "repost_resolution_jobs",
        ["deletion_job_id"],
        unique=False,
    )


def downgrade() -> None:
    if "repost_resolution_jobs" not in sa.inspect(op.get_bind()).get_table_names():
        return
    op.drop_index(
        op.f("ix_repost_resolution_jobs_deletion_job_id"),
        table_name="repost_resolution_jobs",
    )
    op.drop_table("repost_resolution_jobs")
