"""Годовая подписка: у счёта появляется период оплаты.

Тарифов по-прежнему два, терминал и Про, но платить за них можно месяцем или
годом (500 и 1100 USDT). Период лежит у счёта, а не у подписки: сколько дней
дал платёж, решает он сам, и годовая оплата поверх месячной просто продлевает
ту же подписку.

Старые счета остаются месячными - для них и стоит значение по умолчанию.

Ревизия: 0008
Предыдущая: 0007
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008'
down_revision: Union[str, None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('payment_intents', schema=None) as batch_op:
        batch_op.add_column(sa.Column('period', sa.String(length=8), server_default='month', nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('payment_intents', schema=None) as batch_op:
        batch_op.drop_column('period')

