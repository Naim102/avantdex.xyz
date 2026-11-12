"""widen role label columns (an admin wallet may carry several legacy role rows)

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # widening a varchar does not rewrite rows, so the append-only trigger on audit_logs is not involved
    op.alter_column('audit_logs', 'role', existing_type=sa.String(length=32), type_=sa.String(length=255), existing_nullable=False)
    op.alter_column('verification_badges', 'granted_role', existing_type=sa.String(length=32), type_=sa.String(length=255), existing_nullable=False)


def downgrade() -> None:
    pass
