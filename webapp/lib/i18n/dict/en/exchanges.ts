// Exchange showcase in the account area: where the terminal trades, what an
// academy account gives, and how to connect one.

export const exchanges = {
  title: "Exchanges",
  hint: "Where the terminal trades and what an academy account gives",
  lead:
    "An exchange opens once the academy confirms it: send the UID of your account there to the academy bot, and it shows up here with a connect button. Going through the academy means lower fees and cashback.",

  state: {
    active: "active",
    connected: "connected",
    notConnected: "not connected",
    trading: "trading",
    soon: "soon",
    ownBook: "own book",
    sharedBook: "shared book",
  },

  broker: {
    talks: "in talks",
    applied: "application sent",
    live: "broker ID received",
  },

  terms: {
    taker: "taker",
    maker: "maker",
    academy: "academy rate",
    cashback: "fee returned",
    unknown: "terms being agreed",
    noCashback: "not allowed by the exchange",
    note:
      "Reference rates for tier zero: yours is derived from your own trades and always wins. " +
      "The returned fee lands on your exchange account and applies when you registered through the academy " +
      "and trade in the terminal - the same numbers you saw in the academy bot.",
  },

  access: {
    academy: "Opened through the academy: part of the fee comes back to it.",
    own: "Your own account: the terminal works, academy terms do not apply.",
    uid: (uid: string) => `Account ${uid}`,
    needsAcademy:
      "The exchange opens once the academy confirms it: send the UID of your account there " +
      "to the academy bot. Once confirmed, you can connect it here.",
    confirmed: (uids: string) => `Confirmed by the academy: ${uids}`,
  },

  actions: {
    login: "Sign in with the exchange",
    loginSoon: "Exchange sign-in arrives with the broker ID",
    signup: "Open an account",
    keys: "Connect with API keys",
    needsAcademy: "Confirm the account in the academy bot first",
    replace: "Replace keys",
    makeActive: "Place orders from here",
    disconnect: "Disconnect",
    open: "Open the terminal",
  },

  auth: {
    keys: "with keys",
    oauth: "with exchange sign-in",
  },

  login: {
    working: "Waiting for the exchange",
    done: "Account connected",
    failed: "Sign-in failed",
    cancelled: "Sign-in cancelled",
  },

  empty: "No accounts yet: connect the first one and the terminal starts placing orders.",
  vaultOff: "Connecting is off: the server has no encryption key configured.",
};
