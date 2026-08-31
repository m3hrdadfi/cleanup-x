"""Persist local-only inventory removals without deleting source or audit records."""

import sqlalchemy as sa
from alembic import op

revision = "0004_inventory_removals"
down_revision = "0003_scan_max_posts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "inventory_removals" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "inventory_removals",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("scan_id", sa.String(36), sa.ForeignKey("scans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("post_id", sa.String(32), sa.ForeignKey("posts.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_inventory_removals_scan_id", "inventory_removals", ["scan_id"])


def downgrade() -> None:
    op.drop_table("inventory_removals")
