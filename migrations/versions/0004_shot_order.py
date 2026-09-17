"""Порядок снимков в разборе сделки.

Снимки складывают не в том порядке, в каком снимали: сперва прикрепили выход,
потом нашли снимок входа - и он должен встать первым.

Ревизия: 0004
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'trade_shots',
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('trade_shots', 'position')
