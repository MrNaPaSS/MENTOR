"""Первая ревизия: схема базы, какой она была 17 сентября 2026.

Снимок, а не ссылка на модели. Писать здесь `Base.metadata.create_all()` было
бы короче, но тогда эта ревизия на новой базе создавала бы уже сегодняшние
таблицы со всеми будущими полями - и следующая ревизия, добавляющая поле,
падала бы на «колонка уже есть». Поэтому схема выписана целиком и больше не
меняется: всё новое идёт следующими ревизиями.

Боевая база на столе была создана раньше миграций. Её не пересоздают, а
помечают этой ревизией (`migrate_db.py` делает это сам, если схема совпала).

Ревизия: 0001
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('auth_codes',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('weex_uid', sa.String(length=64), nullable=False),
    sa.Column('code', sa.String(length=8), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('auth_codes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_auth_codes_weex_uid'), ['weex_uid'], unique=False)

    op.create_table('broadcasts',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('chart_url', sa.String(length=512), nullable=True),
    sa.Column('symbol', sa.String(length=32), nullable=True),
    sa.Column('audience', sa.String(length=16), nullable=False),
    sa.Column('sent_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('cashback_programs',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('exchange', sa.String(length=16), nullable=False),
    sa.Column('trader_share', sa.Numeric(precision=6, scale=4), nullable=False),
    sa.Column('min_margin', sa.Numeric(precision=6, scale=4), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('valid_from', sa.String(length=10), nullable=False),
    sa.Column('note', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('cashback_programs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_cashback_programs_exchange'), ['exchange'], unique=False)
        batch_op.create_index(batch_op.f('ix_cashback_programs_valid_from'), ['valid_from'], unique=False)

    op.create_table('chart_shots',
    sa.Column('id', sa.String(length=22), nullable=False),
    sa.Column('symbol', sa.String(length=32), nullable=False),
    sa.Column('interval', sa.String(length=8), nullable=False),
    sa.Column('note', sa.String(length=140), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('side', sa.String(length=5), nullable=False),
    sa.Column('owner', sa.String(length=32), nullable=False),
    sa.Column('card_json', sa.Text(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('chat_bridge',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('message_id', sa.BigInteger(), nullable=False),
    sa.Column('tg_chat_id', sa.BigInteger(), nullable=False),
    sa.Column('tg_message_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tg_chat_id', 'tg_message_id', name='uq_bridge_tg')
    )
    with op.batch_alter_table('chat_bridge', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_chat_bridge_message_id'), ['message_id'], unique=True)
        batch_op.create_index(batch_op.f('ix_chat_bridge_tg_chat_id'), ['tg_chat_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_chat_bridge_tg_message_id'), ['tg_message_id'], unique=False)

    op.create_table('chat_threads',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('tg_topic_id', sa.BigInteger(), nullable=True),
    sa.Column('title', sa.String(length=64), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('closed', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('chat_threads', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_chat_threads_tg_topic_id'), ['tg_topic_id'], unique=True)

    op.create_table('leverage_caps',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('symbol', sa.String(length=32), nullable=False),
    sa.Column('leverage', sa.Integer(), nullable=False),
    sa.Column('max_size', sa.Numeric(precision=24, scale=10), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('symbol', 'leverage', name='uq_leverage_cap')
    )
    with op.batch_alter_table('leverage_caps', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_leverage_caps_symbol'), ['symbol'], unique=False)

    op.create_table('settings',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('value', sa.Text(), nullable=False),
    sa.PrimaryKeyConstraint('key')
    )
    op.create_table('shop_items',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('title', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('title_en', sa.String(length=120), nullable=False),
    sa.Column('description_en', sa.Text(), nullable=False),
    sa.Column('price', sa.Integer(), nullable=False),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('section', sa.String(length=16), nullable=False),
    sa.Column('icon', sa.String(length=32), nullable=False),
    sa.Column('link_url', sa.String(length=500), nullable=False),
    sa.Column('image_url', sa.Text(), nullable=False),
    sa.Column('requires_tv', sa.Boolean(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('feature', sa.String(length=32), nullable=False),
    sa.Column('duration_days', sa.Integer(), nullable=False),
    sa.Column('charges', sa.Integer(), nullable=False),
    sa.Column('options', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('signals',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('symbol', sa.String(length=32), nullable=False),
    sa.Column('direction', sa.String(length=8), nullable=False),
    sa.Column('leverage', sa.Integer(), nullable=False),
    sa.Column('entry_price', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('entry_type', sa.String(length=8), nullable=False),
    sa.Column('stop_loss', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('tp1', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('tp2', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('tp3', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('margin_type', sa.String(length=8), nullable=False),
    sa.Column('target_audience', sa.String(length=8), nullable=False),
    sa.Column('has_photo', sa.Boolean(), nullable=False),
    sa.Column('chart_url', sa.String(length=512), nullable=True),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('chat_message_id', sa.BigInteger(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('signals', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_signals_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_signals_symbol'), ['symbol'], unique=False)

    op.create_table('students',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('tg_id', sa.BigInteger(), nullable=True),
    sa.Column('username', sa.String(length=64), nullable=True),
    sa.Column('weex_uid', sa.String(length=64), nullable=True),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('risk_percent', sa.Numeric(precision=6, scale=2), nullable=True),
    sa.Column('turbo_leverage', sa.Integer(), nullable=True),
    sa.Column('language', sa.String(length=2), nullable=False),
    sa.Column('balance_usdt', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('balance_source', sa.String(length=16), nullable=False),
    sa.Column('avatar_url', sa.String(length=256), nullable=True),
    sa.Column('session_key', sa.String(length=32), nullable=True),
    sa.Column('card_name', sa.String(length=32), nullable=True),
    sa.Column('avatar_frame', sa.String(length=32), nullable=True),
    sa.Column('balance_updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('is_approved', sa.Boolean(), nullable=False),
    sa.Column('copy_allowed', sa.Boolean(), nullable=False),
    sa.Column('is_vip', sa.Boolean(), nullable=False),
    sa.Column('vip_source', sa.String(length=16), nullable=False),
    sa.Column('active_exchange', sa.String(length=16), nullable=False),
    sa.Column('journal_delete_allowed', sa.Boolean(), nullable=False),
    sa.Column('coins', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_via', sa.String(length=16), nullable=False),
    sa.Column('first_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('login_count', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('students', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_students_tg_id'), ['tg_id'], unique=True)

    op.create_table('tg_auth_codes',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('tg_id', sa.BigInteger(), nullable=False),
    sa.Column('code_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('tg_auth_codes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tg_auth_codes_code_hash'), ['code_hash'], unique=False)
        batch_op.create_index(batch_op.f('ix_tg_auth_codes_tg_id'), ['tg_id'], unique=False)

    op.create_table('academy_uids',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('exchange', sa.String(length=16), nullable=False),
    sa.Column('uid', sa.String(length=64), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'exchange', 'uid', name='uq_academy_uid')
    )
    with op.batch_alter_table('academy_uids', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_academy_uids_exchange'), ['exchange'], unique=False)
        batch_op.create_index(batch_op.f('ix_academy_uids_student_id'), ['student_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_academy_uids_uid'), ['uid'], unique=False)

    op.create_table('balance_snapshots',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('date', sa.String(length=10), nullable=False),
    sa.Column('balance_usdt', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('futures_volume', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('spot_volume', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'date', name='uq_snapshot_student_date')
    )
    with op.batch_alter_table('balance_snapshots', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_balance_snapshots_date'), ['date'], unique=False)
        batch_op.create_index(batch_op.f('ix_balance_snapshots_student_id'), ['student_id'], unique=False)

    op.create_table('broadcast_comments',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('broadcast_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['broadcast_id'], ['broadcasts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('broadcast_comments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_broadcast_comments_broadcast_id'), ['broadcast_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_broadcast_comments_student_id'), ['student_id'], unique=False)

    op.create_table('broadcast_reactions',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('broadcast_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['broadcast_id'], ['broadcasts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('broadcast_id', 'student_id', 'kind', name='uq_broadcast_reaction')
    )
    with op.batch_alter_table('broadcast_reactions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_broadcast_reactions_broadcast_id'), ['broadcast_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_broadcast_reactions_student_id'), ['student_id'], unique=False)

    op.create_table('cashback_accruals',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('exchange', sa.String(length=16), nullable=False),
    sa.Column('uid', sa.String(length=32), nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=True),
    sa.Column('day', sa.String(length=10), nullable=False),
    sa.Column('fee', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('commission', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('trader_share', sa.Numeric(precision=6, scale=4), nullable=False),
    sa.Column('cashback', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('nmnh', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('program_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['program_id'], ['cashback_programs.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('exchange', 'uid', 'day', name='uq_cashback_accrual_day')
    )
    with op.batch_alter_table('cashback_accruals', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_cashback_accruals_day'), ['day'], unique=False)
        batch_op.create_index(batch_op.f('ix_cashback_accruals_exchange'), ['exchange'], unique=False)
        batch_op.create_index(batch_op.f('ix_cashback_accruals_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_cashback_accruals_student_id'), ['student_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_cashback_accruals_uid'), ['uid'], unique=False)

    op.create_table('certificates',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('level', sa.String(length=8), nullable=False),
    sa.Column('pillars_json', sa.Text(), nullable=False),
    sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('seen_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'level', name='uq_certificate_level')
    )
    with op.batch_alter_table('certificates', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_certificates_student_id'), ['student_id'], unique=False)

    op.create_table('chat_messages',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('attach_json', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('signal_id', sa.BigInteger(), nullable=True),
    sa.Column('reply_to_id', sa.BigInteger(), nullable=True),
    sa.Column('thread_id', sa.BigInteger(), nullable=True),
    sa.Column('links_json', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_chat_messages_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_chat_messages_student_id'), ['student_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_chat_messages_thread_id'), ['thread_id'], unique=False)

    op.create_table('coin_transactions',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('amount', sa.Integer(), nullable=False),
    sa.Column('reason', sa.String(length=32), nullable=False),
    sa.Column('ref', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('pending', sa.Boolean(), nullable=False),
    sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'ref', name='uq_coin_tx_student_ref')
    )
    with op.batch_alter_table('coin_transactions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_coin_transactions_student_id'), ['student_id'], unique=False)

    op.create_table('entitlements',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('feature', sa.String(length=32), nullable=False),
    sa.Column('permanent', sa.Boolean(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('charges', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'feature', name='uq_entitlement')
    )
    with op.batch_alter_table('entitlements', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_entitlements_student_id'), ['student_id'], unique=False)

    op.create_table('exchange_accounts',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('exchange', sa.String(length=16), nullable=False),
    sa.Column('api_key_enc', sa.Text(), nullable=False),
    sa.Column('secret_enc', sa.Text(), nullable=False),
    sa.Column('passphrase_enc', sa.Text(), nullable=False),
    sa.Column('key_tail', sa.String(length=8), nullable=False),
    sa.Column('auth_kind', sa.String(length=8), nullable=False),
    sa.Column('exchange_uid', sa.String(length=64), nullable=False),
    sa.Column('access', sa.String(length=8), nullable=False),
    sa.Column('oauth_token_enc', sa.Text(), nullable=False),
    sa.Column('oauth_refresh_enc', sa.Text(), nullable=False),
    sa.Column('oauth_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'exchange', name='uq_exchange_account')
    )
    with op.batch_alter_table('exchange_accounts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_exchange_accounts_exchange'), ['exchange'], unique=False)
        batch_op.create_index(batch_op.f('ix_exchange_accounts_student_id'), ['student_id'], unique=False)

    op.create_table('journal_exports',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('trades', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('journal_exports', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_journal_exports_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_journal_exports_student_id'), ['student_id'], unique=False)

    op.create_table('live_trades',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('client_id', sa.String(length=64), nullable=False),
    sa.Column('symbol', sa.String(length=32), nullable=False),
    sa.Column('side', sa.String(length=8), nullable=False),
    sa.Column('entry', sa.Numeric(precision=24, scale=10), nullable=False),
    sa.Column('initial_stop', sa.Numeric(precision=24, scale=10), nullable=False),
    sa.Column('current_stop', sa.Numeric(precision=24, scale=10), nullable=False),
    sa.Column('targets_json', sa.Text(), nullable=False),
    sa.Column('qty', sa.Numeric(precision=24, scale=10), nullable=False),
    sa.Column('leverage', sa.Integer(), nullable=False),
    sa.Column('margin', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('takes_hit', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('sl_order_id', sa.String(length=64), nullable=False),
    sa.Column('replaces', sa.Integer(), nullable=False),
    sa.Column('hand_stop', sa.Integer(), nullable=False),
    sa.Column('exchange', sa.String(length=16), nullable=False),
    sa.Column('tp_orders_json', sa.Text(), nullable=False),
    sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'client_id', name='uq_live_trade_client')
    )
    with op.batch_alter_table('live_trades', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_live_trades_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_live_trades_student_id'), ['student_id'], unique=False)
        batch_op.create_index('ix_live_trades_student_status', ['student_id', 'status'], unique=False)
        batch_op.create_index(batch_op.f('ix_live_trades_symbol'), ['symbol'], unique=False)

    op.create_table('scalp_trades',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('client_id', sa.String(length=64), nullable=False),
    sa.Column('symbol', sa.String(length=32), nullable=False),
    sa.Column('side', sa.String(length=8), nullable=False),
    sa.Column('entry', sa.Numeric(precision=24, scale=10), nullable=False),
    sa.Column('stop', sa.Numeric(precision=24, scale=10), nullable=False),
    sa.Column('exit_price', sa.Numeric(precision=24, scale=10), nullable=True),
    sa.Column('qty', sa.Numeric(precision=24, scale=10), nullable=False),
    sa.Column('margin', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('leverage', sa.Integer(), nullable=False),
    sa.Column('takes_hit', sa.Integer(), nullable=False),
    sa.Column('targets_json', sa.Text(), nullable=False),
    sa.Column('outcome', sa.String(length=8), nullable=False),
    sa.Column('pnl', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('fee', sa.Numeric(precision=20, scale=8), nullable=False),
    sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('note', sa.String(length=255), nullable=False),
    sa.Column('from_exchange', sa.Boolean(), nullable=False),
    sa.Column('exchange', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('student_id', 'client_id', name='uq_scalp_trade_client')
    )
    with op.batch_alter_table('scalp_trades', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_scalp_trades_closed_at'), ['closed_at'], unique=False)
        batch_op.create_index('ix_scalp_trades_student_closed', ['student_id', 'closed_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_scalp_trades_student_id'), ['student_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_scalp_trades_symbol'), ['symbol'], unique=False)

    op.create_table('scalp_workspaces',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('payload', sa.Text(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('scalp_workspaces', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_scalp_workspaces_student_id'), ['student_id'], unique=True)

    op.create_table('shop_orders',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('item_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=True),
    sa.Column('item_title', sa.String(length=120), nullable=False),
    sa.Column('price', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('contact', sa.String(length=255), nullable=False),
    sa.Column('mentor_note', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['item_id'], ['shop_items.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('shop_orders', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_shop_orders_student_id'), ['student_id'], unique=False)

    op.create_table('signal_deliveries',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('signal_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('balance_at_signal', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('margin_usd', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('position_size', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('risk_usd', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('profit_tp1', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('profit_tp2', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('profit_tp3', sa.Numeric(precision=20, scale=8), nullable=True),
    sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['signal_id'], ['signals.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('signal_id', 'student_id', name='uq_delivery_signal_student')
    )
    with op.batch_alter_table('signal_deliveries', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_signal_deliveries_signal_id'), ['signal_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_signal_deliveries_student_id'), ['student_id'], unique=False)

    op.create_table('weex_credentials',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('api_key_enc', sa.Text(), nullable=False),
    sa.Column('secret_enc', sa.Text(), nullable=False),
    sa.Column('passphrase_enc', sa.Text(), nullable=False),
    sa.Column('key_tail', sa.String(length=8), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('weex_credentials', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_weex_credentials_student_id'), ['student_id'], unique=True)



def downgrade() -> None:
    with op.batch_alter_table('weex_credentials', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_weex_credentials_student_id'))

    op.drop_table('weex_credentials')
    with op.batch_alter_table('signal_deliveries', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_signal_deliveries_student_id'))
        batch_op.drop_index(batch_op.f('ix_signal_deliveries_signal_id'))

    op.drop_table('signal_deliveries')
    with op.batch_alter_table('shop_orders', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_shop_orders_student_id'))

    op.drop_table('shop_orders')
    with op.batch_alter_table('scalp_workspaces', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_scalp_workspaces_student_id'))

    op.drop_table('scalp_workspaces')
    with op.batch_alter_table('scalp_trades', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_scalp_trades_symbol'))
        batch_op.drop_index(batch_op.f('ix_scalp_trades_student_id'))
        batch_op.drop_index('ix_scalp_trades_student_closed')
        batch_op.drop_index(batch_op.f('ix_scalp_trades_closed_at'))

    op.drop_table('scalp_trades')
    with op.batch_alter_table('live_trades', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_live_trades_symbol'))
        batch_op.drop_index('ix_live_trades_student_status')
        batch_op.drop_index(batch_op.f('ix_live_trades_student_id'))
        batch_op.drop_index(batch_op.f('ix_live_trades_status'))

    op.drop_table('live_trades')
    with op.batch_alter_table('journal_exports', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_journal_exports_student_id'))
        batch_op.drop_index(batch_op.f('ix_journal_exports_created_at'))

    op.drop_table('journal_exports')
    with op.batch_alter_table('exchange_accounts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_exchange_accounts_student_id'))
        batch_op.drop_index(batch_op.f('ix_exchange_accounts_exchange'))

    op.drop_table('exchange_accounts')
    with op.batch_alter_table('entitlements', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_entitlements_student_id'))

    op.drop_table('entitlements')
    with op.batch_alter_table('coin_transactions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_coin_transactions_student_id'))

    op.drop_table('coin_transactions')
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_chat_messages_thread_id'))
        batch_op.drop_index(batch_op.f('ix_chat_messages_student_id'))
        batch_op.drop_index(batch_op.f('ix_chat_messages_created_at'))

    op.drop_table('chat_messages')
    with op.batch_alter_table('certificates', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_certificates_student_id'))

    op.drop_table('certificates')
    with op.batch_alter_table('cashback_accruals', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_cashback_accruals_uid'))
        batch_op.drop_index(batch_op.f('ix_cashback_accruals_student_id'))
        batch_op.drop_index(batch_op.f('ix_cashback_accruals_status'))
        batch_op.drop_index(batch_op.f('ix_cashback_accruals_exchange'))
        batch_op.drop_index(batch_op.f('ix_cashback_accruals_day'))

    op.drop_table('cashback_accruals')
    with op.batch_alter_table('broadcast_reactions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_broadcast_reactions_student_id'))
        batch_op.drop_index(batch_op.f('ix_broadcast_reactions_broadcast_id'))

    op.drop_table('broadcast_reactions')
    with op.batch_alter_table('broadcast_comments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_broadcast_comments_student_id'))
        batch_op.drop_index(batch_op.f('ix_broadcast_comments_broadcast_id'))

    op.drop_table('broadcast_comments')
    with op.batch_alter_table('balance_snapshots', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_balance_snapshots_student_id'))
        batch_op.drop_index(batch_op.f('ix_balance_snapshots_date'))

    op.drop_table('balance_snapshots')
    with op.batch_alter_table('academy_uids', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_academy_uids_uid'))
        batch_op.drop_index(batch_op.f('ix_academy_uids_student_id'))
        batch_op.drop_index(batch_op.f('ix_academy_uids_exchange'))

    op.drop_table('academy_uids')
    with op.batch_alter_table('tg_auth_codes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_tg_auth_codes_tg_id'))
        batch_op.drop_index(batch_op.f('ix_tg_auth_codes_code_hash'))

    op.drop_table('tg_auth_codes')
    with op.batch_alter_table('students', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_students_tg_id'))

    op.drop_table('students')
    with op.batch_alter_table('signals', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_signals_symbol'))
        batch_op.drop_index(batch_op.f('ix_signals_status'))

    op.drop_table('signals')
    op.drop_table('shop_items')
    op.drop_table('settings')
    with op.batch_alter_table('leverage_caps', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_leverage_caps_symbol'))

    op.drop_table('leverage_caps')
    with op.batch_alter_table('chat_threads', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_chat_threads_tg_topic_id'))

    op.drop_table('chat_threads')
    with op.batch_alter_table('chat_bridge', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_chat_bridge_tg_message_id'))
        batch_op.drop_index(batch_op.f('ix_chat_bridge_tg_chat_id'))
        batch_op.drop_index(batch_op.f('ix_chat_bridge_message_id'))

    op.drop_table('chat_bridge')
    op.drop_table('chart_shots')
    with op.batch_alter_table('cashback_programs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_cashback_programs_valid_from'))
        batch_op.drop_index(batch_op.f('ix_cashback_programs_exchange'))

    op.drop_table('cashback_programs')
    op.drop_table('broadcasts')
    with op.batch_alter_table('auth_codes', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_auth_codes_weex_uid'))

    op.drop_table('auth_codes')
