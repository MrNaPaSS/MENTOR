"""Очередь событий для бота: оплата, скорое окончание, окончание.

Платформа не ходит в Telegram сама - у неё нет ни токена бота, ни права писать
людям. События ложатся сюда, бот забирает пачку и отмечает забранное.

Указатель `notification_events_once` - от задвоения: напоминание «кончается
через три дня» ставится каждым проходом, и без ключа повторов человек получил
бы его семьдесят два раза.

Ревизия: 0007
Предыдущая: 0006
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('notification_events',
    sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('event', sa.String(length=32), nullable=False),
    sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
    sa.Column('tg_id', sa.BigInteger(), nullable=True),
    sa.Column('payload', sa.Text(), nullable=False),
    sa.Column('dedup', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('acked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('notification_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_notification_events_acked_at'), ['acked_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_notification_events_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_notification_events_kind'), ['kind'], unique=False)
        batch_op.create_index(batch_op.f('ix_notification_events_student_id'), ['student_id'], unique=False)
        batch_op.create_index('notification_events_once', ['kind', 'event', 'student_id', 'dedup'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('notification_events', schema=None) as batch_op:
        batch_op.drop_index('notification_events_once')
        batch_op.drop_index(batch_op.f('ix_notification_events_student_id'))
        batch_op.drop_index(batch_op.f('ix_notification_events_kind'))
        batch_op.drop_index(batch_op.f('ix_notification_events_created_at'))
        batch_op.drop_index(batch_op.f('ix_notification_events_acked_at'))

    op.drop_table('notification_events')
