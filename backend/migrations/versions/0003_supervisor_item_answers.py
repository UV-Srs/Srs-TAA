"""supervisor item answers: store the supervisor's saved Yes/No answers for each item

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-26

Adds one nullable JSON column to supervisor_lot_reviews. Existing reviews keep NULL,
which means the supervisor has not saved any item answers yet.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('supervisor_lot_reviews', sa.Column('item_answers', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('supervisor_lot_reviews', 'item_answers')
