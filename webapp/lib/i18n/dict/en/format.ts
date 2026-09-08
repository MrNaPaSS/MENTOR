export const format = {
  modeModerate: "MODERATE",
  modeTurbo: "TURBO",

  ago: {
    never: "never",
    now: "just now",
    minutes: (n: number) => `${n} min ago`,
    hours: (n: number) => `${n} h ago`,
    yesterday: "yesterday",
    days: (n: number) => (n === 1 ? "1 day ago" : `${n} days ago`),
    months: (n: number) => (n === 1 ? "1 month ago" : `${n} months ago`),
    years: (n: number) => (n === 1 ? "1 year ago" : `${n} years ago`),
  },

  source: {
    academy: "academy",
    web: "site",
    bot: "bot",
  },
};
