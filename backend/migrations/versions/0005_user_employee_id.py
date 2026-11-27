"""optional employee id on users (separate from the login username)

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-27

users.employee_id is a new nullable, unique column. Existing users keep working unchanged.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('employee_id', sa.String(length=50), nullable=True))
    op.create_index('ix_users_employee_id', 'users', ['employee_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_users_employee_id', table_name='users')
    op.drop_column('users', 'employee_id')
