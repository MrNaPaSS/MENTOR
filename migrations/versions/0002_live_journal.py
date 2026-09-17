"""Журнал ведёт сделку с открытия, а не только закрытую.

Трейдер, взявший две цели из трёх, не видел в журнале ничего - хотя
зафиксированные деньги у него уже были. Теперь запись появляется при открытии
и живёт до конца: `closed_at` пуст, пока сделка в работе, а `closed_qty`
говорит, какая часть позиции уже закрыта.

Ревизия: 0002
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Колонку добавляем обычным ALTER: его умеет и SQLite.
    op.add_column(
        'scalp_trades',
        sa.Column(
            'closed_qty',
            sa.Numeric(precision=24, scale=10),
            nullable=False,
            server_default='0',
        ),
    )
    # А смену «обязательное на необязательное» SQLite не умеет вовсе, и
    # alembic пересобирает таблицу целиком (batch). Обе операции в одном
    # batch он свести не может - ловит круговую зависимость колонок, - поэтому
    # они идут порознь. На Postgres это обычный ALTER.
    with op.batch_alter_table('scalp_trades') as batch:
        batch.alter_column(
            'closed_at', existing_type=sa.DateTime(timezone=True), nullable=True
        )


def downgrade() -> None:
    # Назад - только записи закрытых сделок: у тех, что в работе, даты
    # закрытия нет, и колонка снова стала бы обязательной с пустым значением.
    op.execute("DELETE FROM scalp_trades WHERE closed_at IS NULL")
    with op.batch_alter_table('scalp_trades') as batch:
        batch.alter_column(
            'closed_at', existing_type=sa.DateTime(timezone=True), nullable=False
        )
    op.drop_column('scalp_trades', 'closed_qty')
