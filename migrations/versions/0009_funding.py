"""Плата за финансирование: у сделки появляется своя строка расходов.

Журнал сходился с биржей на коротких сделках и расходился на долгих. Разбор
шорта TAO, провисевшего 34 часа: результат по исполнениям 1287.80, комиссия
47.38 - оба числа сошлись с биржей до копейки, - а карточка позиции показывала
1262.56. Разницу в 25.24 не объясняли ни расчёт, ни комиссия.

Это плата за финансирование. Биржа берёт её раз в несколько часов, поэтому
сделка, закрытая между расчётами, не платит её вовсе - отсюда и то, что
расходились только долгие. Во всём торговом коде её не было: WEEX отдаёт её по
позиции полем `cumFundingFee`, и никто его не читал.

Знак берём биржин: минус - платил, плюс - получал. По лонгу TRX у одного
ученика набежало +273.05, по лонгу MYX -255.95 - величины совсем не
символические.

`live_trades.funding` копится по ходу сделки: после закрытия позиция исчезает
вместе со своими числами, и спросить будет негде. `scalp_trades.funding` -
то, что осталось в журнале.

Ревизия: 0009
Предыдущая: 0008
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ('scalp_trades', 'live_trades'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    'funding',
                    sa.Numeric(20, 8),
                    server_default='0',
                    nullable=False,
                )
            )


def downgrade() -> None:
    for table in ('scalp_trades', 'live_trades'):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_column('funding')
