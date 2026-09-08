// Оболочка кабинета: шапка, навигация, общие для всех разделов подписи.

export const shell = {
  nav: {
    scalping: "Терминал",
    market: "Рынок",
    analysis: "Анализы",
    news: "ТВ",
    analytics: "Аналитика",
    shop: "Маркет",
    profile: "Профиль",
  },
  coinsTitle: "NMNH монеты - за что начислены",
  logout: "Выйти",

  radio: {
    play: (station: string) => `Радио - ${station}`,
    stop: (station: string) => `${station} - нажмите, чтобы выключить`,
    change: (station: string) => `${station} - сменить станцию`,
    changeAria: (station: string) => `Станция ${station} - сменить станцию`,
    volume: "звук",
    volumeAria: "Громкость радио",
  },
  noChartData: "Нет данных для построения графика",
};
