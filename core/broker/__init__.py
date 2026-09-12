"""Брокерская программа: метка заявок и расчёт ребейта.

Смысл модели — в [docs/integrations/broker-program-plan.md](../../docs/integrations/broker-program-plan.md):
биржа платит NMNH часть комиссии за заявки с меткой брокера, часть этих денег
возвращается трейдеру.
"""

from core.broker.tag import NO_MARK, BrokerMark, weex_algo_mark, weex_mark

__all__ = ["BrokerMark", "NO_MARK", "weex_algo_mark", "weex_mark"]
