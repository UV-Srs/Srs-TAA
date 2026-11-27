"""baseline: the complete TAA schema as it exists today

Revision ID: 0001
Revises:
Create Date: 2026-11-24

This is the schema the application has always built on its own (create_all() plus one manual
ALTER), captured as one migration. It was verified two ways before being added:
  * built on an empty PostgreSQL database it is identical to a database created by the old startup code
  * a restored copy of a populated database shows zero differences from it

Fresh databases get it by running `alembic upgrade head`.
Databases that already hold this schema are NOT upgraded to it: after the drift check shows zero
differences they are marked with `alembic stamp 0001`, which changes no tables and no data.
(See "Database migrations" in README.md.)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('users',
    sa.Column('user_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('username', sa.String(length=100), nullable=False),
    sa.Column('full_name', sa.String(length=150), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_index(op.f('ix_users_user_id'), 'users', ['user_id'], unique=False)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
    op.create_table('audit_logs',
    sa.Column('log_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('role', sa.String(length=20), nullable=True),
    sa.Column('action_type', sa.String(length=100), nullable=False),
    sa.Column('sheet_id', sa.String(length=64), nullable=True),
    sa.Column('batch_id', sa.Integer(), nullable=True),
    sa.Column('details', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.user_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('log_id')
    )
    op.create_index(op.f('ix_audit_logs_user_id'), 'audit_logs', ['user_id'], unique=False)
    op.create_table('sheet_templates',
    sa.Column('sheet_id', sa.String(length=64), nullable=False),
    sa.Column('document_title', sa.String(length=255), nullable=False),
    sa.Column('part_no', sa.String(length=100), nullable=True),
    sa.Column('part_name', sa.String(length=150), nullable=True),
    sa.Column('model_name', sa.String(length=150), nullable=True),
    sa.Column('vendor_name', sa.String(length=150), nullable=True),
    sa.Column('customer_name', sa.String(length=150), nullable=True),
    sa.Column('part_category', sa.String(length=50), nullable=True),
    sa.Column('qr_code_value', sa.String(length=255), nullable=False),
    sa.Column('barcode_value', sa.String(length=255), nullable=False),
    sa.Column('external_barcode', sa.String(length=255), nullable=True),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('sheet_id')
    )
    op.create_index(op.f('ix_sheet_templates_barcode_value'), 'sheet_templates', ['barcode_value'], unique=True)
    op.create_index(op.f('ix_sheet_templates_qr_code_value'), 'sheet_templates', ['qr_code_value'], unique=True)
    op.create_index(op.f('ix_sheet_templates_sheet_id'), 'sheet_templates', ['sheet_id'], unique=False)
    op.create_table('inspection_batches',
    sa.Column('batch_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('sheet_id', sa.String(length=64), nullable=False),
    sa.Column('lot_number', sa.String(length=100), nullable=False),
    sa.Column('product_name', sa.String(length=150), nullable=True),
    sa.Column('line_name', sa.String(length=100), nullable=True),
    sa.Column('lot_quantity', sa.Integer(), nullable=True),
    sa.Column('inspection_mode', sa.String(length=30), nullable=True),
    sa.Column('round', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=40), nullable=True),
    sa.Column('operator_decision', sa.String(length=30), nullable=True),
    sa.Column('operator_rejected_fields', sa.JSON(), nullable=True),
    sa.Column('operator_submitted_at', sa.DateTime(), nullable=True),
    sa.Column('prepared_by', sa.Integer(), nullable=True),
    sa.Column('supervisor_reviews', sa.JSON(), nullable=True),
    sa.Column('supervisor_submitted_at', sa.DateTime(), nullable=True),
    sa.Column('checked_by', sa.Integer(), nullable=True),
    sa.Column('approved_by', sa.Integer(), nullable=True),
    sa.Column('hold_reason', sa.String(length=100), nullable=True),
    sa.Column('hold_note', sa.Text(), nullable=True),
    sa.Column('hold_by', sa.Integer(), nullable=True),
    sa.Column('hold_at', sa.DateTime(), nullable=True),
    sa.Column('hold_due_at', sa.DateTime(), nullable=True),
    sa.Column('hold_alerted', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['approved_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['checked_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['hold_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['prepared_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['sheet_id'], ['sheet_templates.sheet_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('batch_id')
    )
    op.create_index(op.f('ix_inspection_batches_lot_number'), 'inspection_batches', ['lot_number'], unique=False)
    op.create_index(op.f('ix_inspection_batches_sheet_id'), 'inspection_batches', ['sheet_id'], unique=False)
    op.create_table('template_control_items',
    sa.Column('item_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('sheet_id', sa.String(length=64), nullable=False),
    sa.Column('serial_no', sa.Integer(), nullable=False),
    sa.Column('stage_name', sa.String(length=100), nullable=False),
    sa.Column('control_item_name', sa.String(length=255), nullable=False),
    sa.Column('specification_content', sa.Text(), nullable=False),
    sa.Column('application_method', sa.String(length=100), nullable=True),
    sa.Column('normal_frequency', sa.String(length=50), nullable=True),
    sa.Column('ifm_frequency', sa.String(length=50), nullable=True),
    sa.Column('row_mode', sa.String(length=30), nullable=False),
    sa.Column('html_input_type', sa.String(length=30), nullable=False),
    sa.Column('sample_columns', sa.JSON(), nullable=False),
    sa.Column('min_val', sa.Float(), nullable=True),
    sa.Column('max_val', sa.Float(), nullable=True),
    sa.Column('unit', sa.String(length=30), nullable=True),
    sa.Column('assigned_role', sa.String(length=20), nullable=False),
    sa.Column('is_supervisor_checkpoint', sa.Boolean(), nullable=True),
    sa.Column('visible_to_operator', sa.Boolean(), nullable=True),
    sa.Column('editable_by_operator', sa.Boolean(), nullable=True),
    sa.Column('visible_to_supervisor', sa.Boolean(), nullable=True),
    sa.Column('is_required', sa.Boolean(), nullable=True),
    sa.Column('display_order', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['sheet_id'], ['sheet_templates.sheet_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('item_id')
    )
    op.create_index(op.f('ix_template_control_items_sheet_id'), 'template_control_items', ['sheet_id'], unique=False)
    op.create_table('batch_cell_responses',
    sa.Column('response_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('batch_id', sa.Integer(), nullable=False),
    sa.Column('item_id', sa.Integer(), nullable=False),
    sa.Column('column_key', sa.String(length=50), nullable=False),
    sa.Column('cell_value', sa.Text(), nullable=True),
    sa.Column('is_within_spec', sa.Boolean(), nullable=True),
    sa.Column('checker_initials', sa.String(length=20), nullable=True),
    sa.Column('entered_by', sa.Integer(), nullable=True),
    sa.Column('client_mutation_id', sa.String(length=64), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['batch_id'], ['inspection_batches.batch_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['entered_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['item_id'], ['template_control_items.item_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('response_id'),
    sa.UniqueConstraint('client_mutation_id')
    )
    op.create_index(op.f('ix_batch_cell_responses_batch_id'), 'batch_cell_responses', ['batch_id'], unique=False)
    op.create_index(op.f('ix_batch_cell_responses_item_id'), 'batch_cell_responses', ['item_id'], unique=False)
    op.create_table('in_app_notifications',
    sa.Column('notification_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('recipient_role', sa.String(length=20), nullable=True),
    sa.Column('recipient_user_id', sa.Integer(), nullable=True),
    sa.Column('batch_id', sa.Integer(), nullable=True),
    sa.Column('batch_code', sa.String(length=100), nullable=True),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('is_read', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['batch_id'], ['inspection_batches.batch_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['recipient_user_id'], ['users.user_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('notification_id')
    )
    op.create_table('inspection_attachments',
    sa.Column('attachment_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('batch_id', sa.Integer(), nullable=False),
    sa.Column('item_id', sa.Integer(), nullable=True),
    sa.Column('uploaded_by', sa.Integer(), nullable=True),
    sa.Column('capture_source', sa.String(length=30), nullable=False),
    sa.Column('file_path', sa.Text(), nullable=False),
    sa.Column('file_name', sa.String(length=255), nullable=True),
    sa.Column('uploaded_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['batch_id'], ['inspection_batches.batch_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['item_id'], ['template_control_items.item_id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['uploaded_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('attachment_id')
    )
    op.create_index(op.f('ix_inspection_attachments_batch_id'), 'inspection_attachments', ['batch_id'], unique=False)
    op.create_table('inspection_decisions',
    sa.Column('decision_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('batch_id', sa.Integer(), nullable=False),
    sa.Column('round', sa.Integer(), nullable=True),
    sa.Column('stage', sa.String(length=50), nullable=False),
    sa.Column('decided_by', sa.Integer(), nullable=True),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('decision', sa.String(length=50), nullable=False),
    sa.Column('rejected_fields', sa.JSON(), nullable=True),
    sa.Column('rejected_item_ids', sa.JSON(), nullable=True),
    sa.Column('remarks', sa.Text(), nullable=True),
    sa.Column('decided_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['batch_id'], ['inspection_batches.batch_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['decided_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('decision_id')
    )
    op.create_index(op.f('ix_inspection_decisions_batch_id'), 'inspection_decisions', ['batch_id'], unique=False)
    op.create_table('supervisor_lot_reviews',
    sa.Column('review_id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('batch_id', sa.Integer(), nullable=False),
    sa.Column('round', sa.Integer(), nullable=False),
    sa.Column('dispositions', sa.JSON(), nullable=False),
    sa.Column('locked_by', sa.Integer(), nullable=True),
    sa.Column('locked_at', sa.DateTime(), nullable=True),
    sa.Column('oos_action', sa.String(length=50), nullable=True),
    sa.Column('spot_checks', sa.JSON(), nullable=True),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('reopen_note', sa.Text(), nullable=True),
    sa.Column('reopened_by', sa.Integer(), nullable=True),
    sa.Column('reopened_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['batch_id'], ['inspection_batches.batch_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['locked_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['reopened_by'], ['users.user_id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('review_id'),
    sa.UniqueConstraint('batch_id', 'round', name='uq_supervisor_lot_review_round')
    )
    op.create_index(op.f('ix_supervisor_lot_reviews_batch_id'), 'supervisor_lot_reviews', ['batch_id'], unique=False)


def downgrade() -> None:
    # The baseline is the schema every database already has. Dropping it would delete all data,
    # so there is deliberately no automatic way back from here: restore the pre-migration backup.
    raise RuntimeError("Refusing to downgrade past the baseline (0001): it would drop every table. Restore the backup instead.")
