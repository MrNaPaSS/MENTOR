"""Снимки к сделкам и план трейдера на неделю.

Разбор сделки задним числом - это разговор о картинке: где был вход, что
стояло в стакане, как выглядел график до и после. Снимки уже умели жить на
сервере, не хватало связи со сделкой. План недели лежит рядом с журналом:
в понедельник записал правила, к пятнице видно, сколько раз их нарушил.

Ревизия: 0003
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'trade_shots',
        sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
        sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
        sa.Column('client_id', sa.String(length=64), nullable=False),
        sa.Column('shot_id', sa.String(length=22), nullable=False),
        sa.Column('note', sa.String(length=140), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_trade_shots_student_id', 'trade_shots', ['student_id'])
    op.create_index(
        'ix_trade_shots_student_client', 'trade_shots', ['student_id', 'client_id']
    )

    op.create_table(
        'week_plans',
        sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), autoincrement=True, nullable=False),
        sa.Column('student_id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), nullable=False),
        sa.Column('week', sa.String(length=8), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('student_id', 'week', name='uq_week_plan'),
    )
    op.create_index('ix_week_plans_student_id', 'week_plans', ['student_id'])


def downgrade() -> None:
    op.drop_index('ix_week_plans_student_id', table_name='week_plans')
    op.drop_table('week_plans')
    op.drop_index('ix_trade_shots_student_client', table_name='trade_shots')
    op.drop_index('ix_trade_shots_student_id', table_name='trade_shots')
    op.drop_table('trade_shots')
