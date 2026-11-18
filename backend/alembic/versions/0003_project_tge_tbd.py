"""projects.tge_tbd: the team has not fixed the TGE date yet (shown as TBD)

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('tge_tbd', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('projects', 'tge_tbd')
