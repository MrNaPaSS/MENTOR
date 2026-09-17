"""Этап снимка, разбор сделки и отметки дисциплины.

Снимок с этапом перестаёт быть картинкой и становится точкой в истории сделки:
до входа, вход, ведение, выход, разбор. Разбор словами и отметка «по плану или
нарушение» живут у самой сделки - считать дисциплину система не может, она
видит цифры, а не намерение.

Ревизия: 0005
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'trade_shots',
        sa.Column('stage', sa.String(length=12), nullable=False, server_default=''),
    )
    op.add_column(
        'scalp_trades',
        sa.Column('review', sa.Text(), nullable=False, server_default=''),
    )
    op.add_column('scalp_trades', sa.Column('plan_ok', sa.Boolean(), nullable=True))
    op.add_column(
        'scalp_trades',
        sa.Column('mistakes', sa.String(length=120), nullable=False, server_default=''),
    )


def downgrade() -> None:
    op.drop_column('scalp_trades', 'mistakes')
    op.drop_column('scalp_trades', 'plan_ok')
    op.drop_column('scalp_trades', 'review')
    op.drop_column('trade_shots', 'stage')
