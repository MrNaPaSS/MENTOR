// Раздел «Рынок»: панели состояния рынка, скринер, стакан и виджеты.

export const market = {
  title: "Рынок",
  tabs: {
    pulse: { label: "Пульс", hint: "Настроение рынка и деньги за позиции" },
    screener: { label: "Скринер", hint: "Где сегодня работать" },
    news: { label: "Крипто-новости", hint: "Свежие заголовки криптоизданий" },
    smart: { label: "Smart Money", hint: "Что делают крупные" },
    maps: { label: "Карты", hint: "Рынок целиком одной картинкой" },
    calendar: { label: "Календарь", hint: "События, двигающие рынок" },
  },
  tvNote: "Данные и рисование - TradingView",
  // Тихая сноска в углу панели: откуда цифра и насколько она свежая.
  // Появляется только тогда, когда есть что сказать, - у живых данных со
  // своей биржи её нет.
  origin: {
    stale: "не свежие",
    staleFrom: (source: string) => `${source}, не свежие`,
    from: (source: string) => `данные ${source}`,
    mixed: "из разных источников",
    title: "Откуда эти данные",
  },
  news: {
    title: "Крипто-новости",
    loadFailed: "Не удалось загрузить новости",
  },
  widgets: {
    heatmap: { title: "Тепловая карта рынка", hint: "Размер - оборот за сутки, цвет - изменение цены" },
    forex: { title: "Валютные пары", hint: "Кросс-курсы восьми основных валют" },
    etf: { title: "Биткоин-ETF", hint: "Сколько биткоина держат фонды и как ходит их бумага" },
    calendar: { title: "Календарь событий", hint: "Что двигает рынок на этой неделе: ставки, инфляция, занятость" },
  },

  calendar: {
    emptyNote: "Источник календаря не ответил",
    today: "сегодня",
    previousTitle: "Прошлое значение",
    day: (key: string) => {
      const [y, m, d] = key.split("-").map(Number);
      const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
      return new Intl.DateTimeFormat("ru-RU", {
        weekday: "short", day: "numeric", month: "long", timeZone: "UTC",
      }).format(date);
    },
  },

  etf: {
    totalLabel: "Всего у фондов",
    share: (pct: number) => `${pct.toFixed(1)}% рынка`,
  },

  pane: {
    emptyNote: "Источник не ответил",
    liveTitle: "Данные обновляются сами",
    snapshotTitle: "Снимок на момент открытия",
    snapshot: "Снимок",
  },

  global: {
    title: "Рынок целиком",
    live1m: "1 мин",
    noData: "Нет данных",
    marketCap: { label: "Капитализация", hint: "Стоимость всех монет вместе" },
    volume24h: { label: "Объём 24ч", hint: "Сколько наторговали за сутки" },
    change24h: { label: "Изменение 24ч", hint: "Насколько выросла или упала капитализация за сутки" },
    btcDominance: { label: "Доминация BTC", hint: "Доля биткоина в капитализации рынка" },
    coins: { label: "Монет в обращении", hint: "Сколько монет учитывает источник" },
    failed: "Источник не ответил",
    asking: "Спрашиваем источник...",
  },

  bitcoin: {
    title: "Биткоин",
    hint: "Цена, позиции и состояние сети",
    live30s: "30 сек",
    noPrice: "Нет цены",
    emptyNote: "Обозреватель сети не ответил",
    exchangePrice: "Цена на бирже",
    change24hTitle: "Изменение цены за сутки",
    openInterest: { label: "Открытый интерес", hint: "Сколько денег стоит в незакрытых позициях по фьючерсу" },
    funding8h: "Ставка 8ч",
    noRate: "Биржа не назвала ставку",
    longsPay: "Ставка положительная: платят лонги",
    shortsPay: "Ставка отрицательная: платят шорты",
    feeLabel: "Комиссия за перевод, сатоши за байт",
    feeFastest: { label: "Срочно", hint: "Попасть в ближайший блок" },
    feeHalfHour: { label: "Полчаса", hint: "Подтверждение примерно за полчаса" },
    feeHour: { label: "Час", hint: "Подтверждение примерно за час" },
    feeEconomy: { label: "Не срочно", hint: "Когда время не важно" },
    hashrate: { label: "Мощность сети", hint: "Совокупная вычислительная мощность майнеров" },
    txPerDay: { label: "Переводов за сутки", hint: "Сколько транзакций сеть провела за сутки" },
    retarget: "Пересчёт сложности",
    retargetTitle: "Насколько изменится сложность добычи в конце периода",
    retargetProgress: (pct: string) => `период пройден на ${pct}%`,
    priceHint: "Цена, позиции и свечи за двое суток",
    networkTitle: "Сеть биткоина",
    networkHint: "Комиссии, мощность и переводы",
  },

  /** Колонка оформления в Пульсе: баннеры, цитата и шаг к терминалу. */
  promo: {
    quote: "Лучшие трейдеры не предсказывают рынок - они готовы к любому сценарию.",
    author: "NMNH",
    cta: ["Торгуй", "со знанием"],
    ctaHint: "Открыть терминал",
    bitcoinAlt: "Биткоин ведёт рынок",
    globalAlt: "Глобальный рынок всегда в движении",
    smartAlt: "Smart Money: следи за движением крупных. Открыть карты",
  },

  fearGreed: {
    title: "Страх и жадность",
    hint: "Настроение рынка от 0 до 100",
    emptyNote: "Индекс сейчас недоступен",
    daysAgo30: "30 дней назад",
    today: "сегодня",
    yesterday: "Вчера",
    weekAgo: "Неделю назад",
    monthAgo: "Месяц назад",
    levels: {
      extremeFear: "Крайний страх",
      fear: "Страх",
      neutral: "Нейтрально",
      greed: "Жадность",
      extremeGreed: "Крайняя жадность",
    },
  },

  funding: {
    title: "Финансирование",
    hintDefault: "Кто платит за удержание позиции",
    hintLongsPay: (n: number, total: number) => `Лонги платят по ${n} из ${total} инструментов`,
    live5m: "5 мин",
    emptyNote: "Биржа не отдала ставки",
    colInstrument: "Инструмент",
    colRate: "Ставка",
    colSkew: "Перекос",
    colSettle: "Расчёт",
    soon: "скоро",
    countdown: (h: number, m: number) => (h > 0 ? `${h}ч ${m}м` : `${m}м`),
    noRateFor: "Биржа не назвала ставку по этому инструменту",
    longsPay: "Ставка положительная: платят лонги",
    shortsPay: "Ставка отрицательная: платят шорты",
  },

  trending: {
    title: "Ищут чаще всего",
    hint: "Внимание приходит раньше объёма",
    emptyNote: "Список поиска недоступен",
    rankTitle: "Место по капитализации",
    priceInBtc: "цена в BTC",
  },

  screener: {
    title: "Скринер рынка",
    subtitle: (n: number) => `${n} инструментов · метрики считает наш сервер`,
    searchPlaceholder: "Монета",
    streamOn: "Поток идёт",
    streamOff: "Нет связи",
    openInTerminal: "Открыть в терминале",
    quietTitle: "По этой монете поток молчит",
    quiet: "тихо",
    notInList: "Такой монеты в списке нет",
    waitingFrame: "Ждём первый кадр от сервера...",
    noStream: "Нет связи с потоком биржи",
    cols: {
      coin: { label: "Монета", hint: "Инструмент и его цена" },
      change: { label: "Изм. 24ч", hint: "Изменение цены за сутки" },
      volume: { label: "Оборот 24ч", hint: "Сколько наторговали за сутки" },
      wall: { label: "Плита", hint: "Крупная заявка рядом с ценой и её удаление в базисных пунктах" },
      imbalance: { label: "Перевес", hint: "Чья сторона стакана плотнее" },
      delta: { label: "Дельта", hint: "Покупки минус продажи по рынку за минуту" },
      range: { label: "Ход", hint: "Размах цены за минуту, базисные пункты" },
      spread: { label: "Спред", hint: "Разница лучших цен, базисные пункты" },
      trades: { label: "Сделок/мин", hint: "Частота сделок по рынку" },
    },
    bidsDenser: "Плотнее сторона покупателей",
    asksDenser: "Плотнее сторона продавцов",
    bigBid: "Крупная заявка на покупку под ценой",
    bigAsk: "Крупная заявка на продажу над ценой",
  },

  ticker: {
    biggestWall: "самая крупная плита в списке",
    wall: (money: string) => `плита ${money}`,
    openChart: "открыть график и стакан",
  },

  orderBook: {
    book: "Книга ордеров",
    trades: "Сделки",
    time: "Время",
    price: "Цена",
    priceUsdt: "Цена (USDT)",
    amount: (ticker: string) => `Сумма (${ticker})`,
    total: (ticker: string) => `Всего (${ticker})`,
    spread: (value: string | null) => `Спред ${value}`,
  },

  overlay: {
    closeTitle: "Закрыть (Esc)",
  },
};
