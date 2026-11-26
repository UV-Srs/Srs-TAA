"""operator lot clearance: store the operator's clearance choice and note on each lot

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-26

Adds two nullable columns to inspection_batches. Existing lots keep NULL, and the supervisor
screens fall back to the clearance worked out from the results, as before.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('inspection_batches', sa.Column('operator_clearance', sa.String(length=60), nullable=True))
    op.add_column('inspection_batches', sa.Column('operator_clearance_note', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('inspection_batches', 'operator_clearance_note')
    op.drop_column('inspection_batches', 'operator_clearance')
