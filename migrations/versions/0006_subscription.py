"""Подписка на терминал за USDT: счета, состояние, история, чтение сети.

Второй вход в терминал для тех, у кого счёт на бирже уже есть и переносить его
они не будут. Пять таблиц: выставленный счёт, состояние подписки, история
оплат, курсор прочитанных блоков и неопознанные переводы.

Два указателя здесь важнее остальных и без них схема неверна:

* `payment_intents_amount_active` - частичный уникальный по ожидающим счетам.
  Плательщик опознаётся точной суммой, и два ожидающих счёта с одинаковой
  суммой сделали бы невозможным понять, кто заплатил.
* `UNIQUE (tx_hash)` в истории оплат - повторный проход наблюдателя по тем же
  блокам не начислит дни дважды.

Ревизия: 0006
Предыдущая: 0005
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('chain_cursor',
    sa.Column('network', sa.String(length=16), nullable=False),
    sa.Column('last_block', sa.BigInteger(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('network')
    )
    op.create_table('orphan_payments',
    sa.Column('tx_hash', sa.String(length=80), nullable=False),
    sa.Column('network', sa.String(length=16), nullable=False),
    sa.Column('from_address', sa.String(length=64), nullable=False),
    sa.Column('amount_raw', sa.String(length=40), nullable=False),
    sa.Column('seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('resolved_student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['resolved_student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('tx_hash')
    )
    with op.batch_alter_table('orphan_payments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_orphan_payments_resolved_student_id'), ['resolved_student_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_orphan_payments_seen_at'), ['seen_at'], unique=False)

    op.create_table('payment_intents',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=True),
    sa.Column('tg_id', sa.BigInteger(), nullable=True),
    sa.Column('plan', sa.String(length=16), nullable=False),
    sa.Column('price_usd', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('network', sa.String(length=16), nullable=False),
    sa.Column('receiver', sa.String(length=64), nullable=False),
    sa.Column('amount_raw', sa.String(length=40), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('tx_hash', sa.String(length=80), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('payment_intents', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_payment_intents_expires_at'), ['expires_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_payment_intents_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_payment_intents_student_id'), ['student_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_payment_intents_tg_id'), ['tg_id'], unique=False)
        batch_op.create_index('payment_intents_amount', ['network', 'amount_raw'], unique=False)
        batch_op.create_index('payment_intents_amount_active', ['network', 'amount_raw'], unique=True, sqlite_where=sa.text("status = 'pending'"), postgresql_where=sa.text("status = 'pending'"))

    op.create_table('subscriptions',
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('plan', sa.String(length=16), nullable=False),
    sa.Column('paid_until', sa.DateTime(timezone=True), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('first_paid_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('gift_granted', sa.Boolean(), nullable=False),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('student_id')
    )
    with op.batch_alter_table('subscriptions', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_subscriptions_paid_until'), ['paid_until'], unique=False)

    op.create_table('subscription_payments',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('intent_id', sa.String(length=36), nullable=True),
    sa.Column('amount_raw', sa.String(length=40), nullable=False),
    sa.Column('tx_hash', sa.String(length=80), nullable=True),
    sa.Column('days_added', sa.Integer(), nullable=False),
    sa.Column('gift_days', sa.Integer(), nullable=False),
    sa.Column('reason', sa.String(length=120), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['intent_id'], ['payment_intents.id'], ),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('tx_hash')
    )
    with op.batch_alter_table('subscription_payments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_subscription_payments_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_subscription_payments_student_id'), ['student_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('subscription_payments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_subscription_payments_student_id'))
        batch_op.drop_index(batch_op.f('ix_subscription_payments_created_at'))

    op.drop_table('subscription_payments')
    with op.batch_alter_table('subscriptions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_subscriptions_paid_until'))

    op.drop_table('subscriptions')
    with op.batch_alter_table('payment_intents', schema=None) as batch_op:
        batch_op.drop_index('payment_intents_amount_active', sqlite_where=sa.text("status = 'pending'"), postgresql_where=sa.text("status = 'pending'"))
        batch_op.drop_index('payment_intents_amount')
        batch_op.drop_index(batch_op.f('ix_payment_intents_tg_id'))
        batch_op.drop_index(batch_op.f('ix_payment_intents_student_id'))
        batch_op.drop_index(batch_op.f('ix_payment_intents_status'))
        batch_op.drop_index(batch_op.f('ix_payment_intents_expires_at'))

    op.drop_table('payment_intents')
    with op.batch_alter_table('orphan_payments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_orphan_payments_seen_at'))
        batch_op.drop_index(batch_op.f('ix_orphan_payments_resolved_student_id'))

    op.drop_table('orphan_payments')
    op.drop_table('chain_cursor')
