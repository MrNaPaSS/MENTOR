"""Плата за финансирование: вторая таблица, отдельной транзакцией.

Продолжение 0009. Здесь `live_trades` - идущие сделки: именно с них плата и
снимается. Сопровождение читает эту таблицу на каждом обходе, то есть каждые
несколько секунд, и вместе с `scalp_trades` в одной транзакции она давала
взаимную блокировку - см. 0009, там разобрано подробно.

Отдельная ревизия значит отдельную транзакцию: блокировка берётся одна, и
кольцу ожидания замкнуться не на чем.

Ревизия: 0010
Предыдущая: 0009
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0010'
down_revision: Union[str, None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    _limit_waiting()
    with op.batch_alter_table('live_trades', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('funding', sa.Numeric(20, 8), server_default='0', nullable=False)
        )


def downgrade() -> None:
    _limit_waiting()
    with op.batch_alter_table('live_trades', schema=None) as batch_op:
        batch_op.drop_column('funding')


def _limit_waiting() -> None:
    """Не ждать блокировку дольше пяти секунд. На SQLite молча пропускается."""
    if op.get_bind().dialect.name == 'postgresql':
        op.execute("SET LOCAL lock_timeout = '5s'")
