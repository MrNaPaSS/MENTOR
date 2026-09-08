// Сигналы и анализы ментора: лента, карточка и подробности.

export const signals = {
  discussion: "Обсуждение в чате",
  analysisTitle: "Анализы",
  analysisSubtitle: "Разборы рынка от ментора",
  signalsSubtitle: "Сигналы, рассчитанные под ваш депозит",
  tabAnalysis: "Анализы",
  tabSignals: "Сигналы",
  noActiveSignals: "Нет активных сигналов",
  analysisBadge: "Анализ",
  openChart: "Открыть график",
  chart: "График",
  chartTitle: "Открыть график и стакан",
  emptyAnalysis: "Анализов пока нет",
  emptyAnalysisHint: "Ментор ещё не опубликовал анализ",
  audience: {
    moderate: "Умеренным",
    turbo: "Турбо",
  },

  feedTitle: "Лента сигналов",
  filterAll: "Все",
  filterActive: "Активные",
  filterClosed: "Закрытые",
  depositForCalc: "Депозит для расчёта",
  searchPlaceholder: "Поиск по паре - BTC, ETH, SOL…",
  notFound: "Сигналов не найдено",
  noneYet: "Ментор ещё не опубликовал сигналы",
  changeFilters: "Попробуйте изменить фильтры",
  shown: "Показано",
  activeCount: (n: number) => `${n} активных`,

  leverage: (x: number) => `Плечо ×${x}`,
  entry: "Вход",
  stop: "Стоп",
  stopLoss: "Стоп-лосс",
  margin: "Маржа",
  risk: "Риск",
  profitTp: (tp: number) => `Профит TP${tp}`,
  enterTrade: "Войти в сделку",

  detailBackToFeed: "К ленте",
  notFoundOne: "Сигнал не найден.",
  statusActive: "Активен",
  statusClosed: "Закрыт",
  entryMarket: "по рынку",
  entryLimit: "лимит",
  detailLine: (mode: string, entry: string, marginType: string) =>
    `${mode} · вход ${entry} · маржа ${marginType}`,
  detailNote:
    "Расчёт под твой баланс приходит в Telegram-боте. Это не финансовый совет - торговля сопряжена с риском.",
};
