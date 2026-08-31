"""Add an optional maximum post count to scans."""

import sqlalchemy as sa
from alembic import op

revision = "0003_scan_max_posts"
down_revision = "0002_repost_resolution_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("scans")}
    if "max_posts" not in columns:
        op.add_column(
            "scans",
            sa.Column("max_posts", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("scans")}
    if "max_posts" in columns:
        op.drop_column("scans", "max_posts")
