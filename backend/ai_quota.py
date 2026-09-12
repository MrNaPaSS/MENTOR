"""Сколько ИИ-разборов ученику можно: за окно и за сутки (ТЗ этап 3, §6.2).

Два предела на одну ручку, и ключ у обоих - ученик, а не адрес. У образца
(OpenTerminal) ключом стоит IP, потому что у них нет входа; у нас ученики
сидят за мобильным NAT и делят адреса, и предел по адресу наказал бы
случайных людей.

Счёт живёт в памяти процесса, как и остальные наши пределы: он защищает от
частых нажатий, а от расхода защищает цена в монетах - она записана в базе и
перезапуск её не обнуляет.
"""

from __future__ import annotations

from backend.ratelimit import RateLimiter

DAY_SECONDS = 24 * 3600


class AnalyzeQuota:
    """Оконный и суточный счёт разборов на ученика."""

    def __init__(self, per_window: int, window_seconds: int, per_day: int):
        self.window = RateLimiter(per_window, window_seconds)
        self.daily = RateLimiter(per_day, DAY_SECONDS)

    def retry_after(self, student_id: int, now: float | None = None) -> int:
        """Ноль - разбор можно. Иначе через сколько секунд освободится место.

        Берём больший из двух ожиданий: пока не пройдёт суточный, оконный
        ничего не решает.
        """
        key = str(student_id)
        return max(self.window.retry_after(key, now), self.daily.retry_after(key, now))

    def record(self, student_id: int, now: float | None = None) -> None:
        """Засчитать состоявшийся разбор обоим пределам.

        Отдельно от проверки: попытка засчитывается только после того, как
        монеты списаны, - отказ по балансу не должен стоить ученику места в
        окне.
        """
        key = str(student_id)
        self.window.record(key, now)
        self.daily.record(key, now)

    def reset(self) -> None:
        self.window.reset()
        self.daily.reset()
