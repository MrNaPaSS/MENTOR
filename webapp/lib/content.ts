// Статический контент лендинга (ТЗ §5). Не зависит от API.

export const SOCIAL_LINKS = {
  weexAffiliate: "https://www.weex.com/ru/register?vipCode=kaktotakxme",
  telegram: "https://t.me/+81HEkQveJic2YmEy",
  telegramBot: "https://t.me/nmnh_bot",
  // Бот академии: он же выдаёт одноразовый пароль для входа на сайт. Это не
  // сигнальный бот - у них разные роли и разные записи об учениках.
  academyBot: "https://t.me/moneyhoney7_bot",
  youtube: "https://youtube.com/@nmnh",
  tiktok: "https://tiktok.com/@nmnh",
  threads: "https://threads.net/@nmnh",
};

export const NAV_LINKS = [
  { label: "О проекте", href: "#about" },
  { label: "Терминал", href: "#terminal" },
  { label: "Как работает", href: "#how" },
  { label: "Сигналы", href: "#signals" },
  { label: "Результаты", href: "#results" },
  { label: "FAQ", href: "#faq" },
];

export interface HowStep {
  num: string;
  title: string;
  text: string;
  icon: "wallet" | "bot" | "key" | "trending";
}

export const HOW_STEPS: HowStep[] = [
  {
    num: "01",
    title: "Регистрация на WEEX",
    text: "Открой счёт по партнёрской ссылке и пополни депозит - это займёт пару минут.",
    icon: "wallet",
  },
  {
    num: "02",
    title: "Вход через бота",
    text: "Бот академии узнаёт тебя по WEEX UID и выдаёт пароль для входа в кабинет.",
    icon: "bot",
  },
  {
    num: "03",
    title: "Подключение биржи",
    text: "Создай на WEEX API-ключ без права вывода и вставь его в терминал - счёт на связи.",
    icon: "key",
  },
  {
    num: "04",
    title: "Торгуй из терминала",
    text: "Сигнал уже посчитан под депозит: жмёшь «Войти» - сервер ведёт сделку до конца.",
    icon: "trending",
  },
];

export interface Testimonial {
  name: string;
  mode: string;
  quote: string;
  pnl: string;
  avatarSeed: string;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    name: "Артём К.",
    mode: "Умеренный",
    quote: "За 3 месяца поднял депозит с $500 до $1 340. Сигналы реально считаются под мой баланс.",
    pnl: "+168%",
    avatarSeed: "artem",
  },
  {
    name: "Дмитрий В.",
    mode: "Турбо",
    quote: "Турбо-режим не для слабонервных, но риск под контролем - стоп всегда проставлен заранее.",
    pnl: "+312%",
    avatarSeed: "dmitry",
  },
  {
    name: "Игорь С.",
    mode: "Умеренный",
    quote: "Раньше сливал на эмоциях. Теперь чёткий план входа и выхода в каждом сигнале.",
    pnl: "+94%",
    avatarSeed: "igor",
  },
  {
    name: "Павел Р.",
    mode: "Турбо",
    quote: "Удобно, что весь расчёт уже готов - маржа, объём, риск. Просто открываю сделку.",
    pnl: "+221%",
    avatarSeed: "pavel",
  },
  {
    name: "Сергей М.",
    mode: "Умеренный",
    quote: "Лидерборд мотивирует. Видно реальные результаты учеников, а не обещания.",
    pnl: "+127%",
    avatarSeed: "sergey",
  },
];
