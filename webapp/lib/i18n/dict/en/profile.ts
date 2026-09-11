export const profile = {
  avatarAlt: "avatar",
  balance: "Balance",
  balanceFromKeys: "● From your WEEX API keys",
  balanceFromAffiliate: "● Synced with WEEX",
  balanceManual: "● Entered manually",

  exchangeTitle: "Exchange account",
  connected: "connected",
  disconnected: "not connected",
  keyTail: (tail: string) => `Key ···${tail}`,
  keySince: (date: string) => ` · since ${date}`,
  vaultOff: "The key vault isn't configured on the server",
  noKeys: "Without API keys trading from the terminal is unavailable",
  keysNote:
    "Keys are stored encrypted and never returned to the browser - only the last characters, so you can recognise them. Create them with trading rights and withdrawals disabled.",

  settings: "Settings",
  theme: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  language: "Interface language",
  install: "App",
  installAction: "Install to desktop",
  installHint: "The cabinet opens in its own window, without tabs or an address bar",
  sound: "Event sounds",
  cardName: "Name on the card",
  cardNamePlaceholder: "as in Telegram",
  cardNameHint: "Leave empty - the name comes from Telegram",

  adminPanel: "Admin panel",
  /** Word column on the right of the profile bottom banner. */
  bannerWords: ["Community", "Analytics", "Tools", "Growth", "Freedom"],
  logoutAccount: "Log out of the account",
};
