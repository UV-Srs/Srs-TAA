"""audit trail that survives user removal + per-user notification read state

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-26

audit_logs
  * new snapshot columns actor_name / actor_username (who did it, kept even if the user is later
    deleted), ip_address and user_agent. Existing rows are back-filled from the users table.
  * the user_id foreign key changes from ON DELETE CASCADE to ON DELETE SET NULL, so deleting a
    user no longer deletes their history.
  * indexes on created_at and action_type for the paged / filtered audit view.

in_app_notifications
  * new kind and severity columns (existing rows default to 'info').

notification_reads (new)
  * one row per (notification, user) that was read. A notification sent to a whole role used to
    carry a single shared is_read flag. Rows that were already read are back-filled as read for
    every user of that role, so nothing reappears as unread.

No existing data is deleted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _audit_user_fk_name() -> str | None:
    insp = sa.inspect(op.get_bind())
    for fk in insp.get_foreign_keys('audit_logs'):
        if fk.get('referred_table') == 'users' and fk.get('constrained_columns') == ['user_id']:
            return fk.get('name')
    return None


def _replace_audit_user_fk(ondelete: str) -> None:
    name = _audit_user_fk_name()
    if name:
        op.drop_constraint(name, 'audit_logs', type_='foreignkey')
    op.create_foreign_key('audit_logs_user_id_fkey', 'audit_logs', 'users', ['user_id'], ['user_id'], ondelete=ondelete)


def upgrade() -> None:
    # ---- audit_logs ----
    op.add_column('audit_logs', sa.Column('actor_name', sa.String(length=150), nullable=True))
    op.add_column('audit_logs', sa.Column('actor_username', sa.String(length=100), nullable=True))
    op.add_column('audit_logs', sa.Column('ip_address', sa.String(length=64), nullable=True))
    op.add_column('audit_logs', sa.Column('user_agent', sa.String(length=255), nullable=True))
    op.execute(
        "UPDATE audit_logs SET actor_name = u.full_name, actor_username = u.username "
        "FROM users u WHERE audit_logs.user_id = u.user_id"
    )
    _replace_audit_user_fk('SET NULL')
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'], unique=False)
    op.create_index('ix_audit_logs_action_type', 'audit_logs', ['action_type'], unique=False)

    # ---- in_app_notifications ----
    op.add_column('in_app_notifications', sa.Column('kind', sa.String(length=30), nullable=False, server_default='info'))
    op.add_column('in_app_notifications', sa.Column('severity', sa.String(length=10), nullable=False, server_default='info'))

    # ---- notification_reads ----
    op.create_table(
        'notification_reads',
        sa.Column('notification_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('read_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['notification_id'], ['in_app_notifications.notification_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('notification_id', 'user_id'),
    )
    op.create_index('ix_notification_reads_user_id', 'notification_reads', ['user_id'], unique=False)
    # Keep what was already read as read, for every user the notification was addressed to.
    op.execute(
        "INSERT INTO notification_reads (notification_id, user_id, read_at) "
        "SELECT n.notification_id, u.user_id, NOW() FROM in_app_notifications n "
        "JOIN users u ON u.role = n.recipient_role WHERE n.is_read = TRUE"
    )


def downgrade() -> None:
    op.drop_index('ix_notification_reads_user_id', table_name='notification_reads')
    op.drop_table('notification_reads')
    op.drop_column('in_app_notifications', 'severity')
    op.drop_column('in_app_notifications', 'kind')

    op.drop_index('ix_audit_logs_action_type', table_name='audit_logs')
    op.drop_index('ix_audit_logs_created_at', table_name='audit_logs')
    # Rows whose user was deleted have no user to point back at, so they cannot satisfy the old
    # ON DELETE CASCADE foreign key meaningfully; they simply stay with user_id NULL.
    _replace_audit_user_fk('CASCADE')
    op.drop_column('audit_logs', 'user_agent')
    op.drop_column('audit_logs', 'ip_address')
    op.drop_column('audit_logs', 'actor_username')
    op.drop_column('audit_logs', 'actor_name')
