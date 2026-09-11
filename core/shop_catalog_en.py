"""Английские название и описание товаров маркета.

Товар хранит текст на русском - так его заводит ментор. Английская версия
кабинета показывала те же русские карточки. У товара теперь есть свои
английские поля (ShopItem.title_en, description_en): их заполняет ментор в
админке, а для каталога, заведённого платформой, - этот словарь один раз при
запуске (каталог v8).

Ключ - русское название товара, как оно лежит в каталоге.
"""

from __future__ import annotations

CATALOG_EN: dict[str, tuple[str, str]] = {
    # ── Инструменты терминала ──
    "NMNH VISION": (
        "NMNH VISION",
        "Chart markup in one purchase: trend, market structure, order blocks, FVG and "
        "zones. Liquidity shelves, volume and EMA stay free. Forever.",
    ),
    "Кластерная свеча": (
        "Cluster candle",
        "Break any candle down by price level: how much was bought and sold at each "
        "price, where one side dominates and where volume stood like a wall. Forever.",
    ),
    "Объёмные свечи": (
        "Volume candles",
        "A candle's width is its volume: big money shows at a glance, with no "
        "histogram under the chart. Forever.",
    ),
    "Стакан 60 и 100 строк": (
        "Order book 60 and 100 rows",
        "An order book deeper than the working thirty rows: see walls and shelves far "
        "from the price, before it gets there. Forever.",
    ),
    "Шаг стакана ×25": (
        "Order book step ×25",
        "The coarsest order book grid: small orders merge into levels, and on fast "
        "coins you see the real wall instead of dust. Forever.",
    ),
    "Выгрузка журнала: отчёт с диаграммами": (
        "Journal export: report with charts",
        "Three exports a month: a designed trading report - equity curve, results by "
        "day and coin, win rate, profit factor, drawdown, fees - and a table of trades "
        "with a CSV button for Excel. Bought once, forever.",
    ),
    # ── Функции платформы ──
    "Заморозка серии": (
        "Streak freeze",
        "One loss does not break your winning streak: the bonuses for 3, 5 and 10 wins "
        "in a row stay within reach. The charge is spent automatically when a streak of "
        "two or more wins meets a loss.",
    ),
    "Удвоение бонуса за серию - 7 дней": (
        "Double streak bonus - 7 days",
        "For a week, winning-streak bonuses are doubled: 30, 60 and 200 coins instead "
        "of 15, 30 and 100. The daily cap stays the same. Buying again extends the term.",
    ),
    "Разбор сделки с ментором": (
        "Trade review with a mentor",
        "A mentor reviews one of your trades: entry, management, exit and what to do "
        "differently. Put your Telegram and the trade to review in the contact field.",
    ),
    # ── Подписки на индикатор ──
    "Подписка на индикатор - 7 дней": (
        "Indicator subscription - 7 days",
        "Access to the private NMNH indicator on TradingView for 7 days.",
    ),
    "Подписка на индикатор - 14 дней": (
        "Indicator subscription - 14 days",
        "Access to the private NMNH indicator for 14 days.",
    ),
    "Подписка на индикатор - 1 месяц": (
        "Indicator subscription - 1 month",
        "Access to the private NMNH indicator for 30 days. Best value.",
    ),
    # ── Рамки аватара ──
    "Рамка «Неон»": (
        "Neon frame",
        "A dark rim with green neon arcs and an NMNH crown at the bottom. Shows in "
        "chat, the profile and the leaderboard.",
    ),
    "Рамка «Карбон»": ("Carbon frame", "A steel rim with angled chips and a green glow from within."),
    "Рамка «Пульс»": ("Pulse frame", "A double ring with a running dashed line, like a price ticker."),
    "Рамка «Свечи»": (
        "Candles frame",
        "A rim with chart candles on the sides - for those who live in the order book.",
    ),
    "Рамка «Корона»": (
        "Crown frame",
        "A metal rim with the NMNH crown on top. The most striking frame in the store.",
    ),
    # ── Мерч ──
    "Торговый пульт NMNH": (
        "NMNH trading keypad",
        "A macro pad for the terminal: BUY, SELL, OPEN and CLOSE keys and a knob with "
        "a candle screen. Metal body, neon edge lighting, braided cable. The store's "
        "top trophy.",
    ),
    "Комплект: футболка + шорты": (
        "Set: T-shirt + shorts",
        "An NMNH TRADE T-shirt and shorts in one color: chart candles, mountains and "
        "«Better trader, a brighter you» on the back, zippers on the pockets. Cheaper "
        "than buying them separately.",
    ),
    "Футболка NMNH TRADE": (
        "NMNH TRADE T-shirt",
        "An oversized tee: a big logo and candles on the front, mountains and the "
        "slogan on the back, «Discipline creates freedom» on the sleeve.",
    ),
    "Шорты NMNH TRADE": (
        "NMNH TRADE shorts",
        "Shorts with the logo and candles, zip pockets with a crown, metal drawstring tips.",
    ),
    "Кепка NMNH TRADE": (
        "NMNH TRADE cap",
        "3D logo embroidery, candles on the visor with neon piping, a metal crown buckle.",
    ),
    "Торговый журнал с ручкой": (
        "Trading journal with a pen",
        "A hardcover trade journal: every page has entry, exit, result, emotions and "
        "lessons. An NMNH pen and bookmark are included.",
    ),
    "Термобутылка NMNH": (
        "NMNH thermo bottle",
        "A steel thermo bottle with a latch: chart candles rise over the mountains, "
        "«Discipline creates freedom» along the bottom.",
    ),
    "Брелок NMNH": (
        "NMNH keychain",
        "A leather strap, a metal plate with the logo and a tag with candles and a crown.",
    ),
    # ── Наш софт ──
    "Индикатор BlackMirror - TradingView": (
        "BlackMirror indicator - TradingView",
        "Private NMNH indicator on TradingView.",
    ),
    "Индикатор NMNH VISION - TradingView": (
        "NMNH VISION indicator - TradingView",
        "Private NMNH indicator on TradingView.",
    ),
    "Индикатор BmUltra - TradingView": (
        "BmUltra indicator - TradingView",
        "Private NMNH indicator on TradingView.",
    ),
    "Академия NMNH": (
        "NMNH Academy",
        "Learning, trading strategies, an AI agent and the trader's library in one platform.",
    ),
    "Веб-расширение FOREX для Chrome": (
        "FOREX web extension for Chrome",
        "A Chrome extension for forex trading.",
    ),
}
