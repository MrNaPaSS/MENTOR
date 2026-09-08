export const auth = {
  title: "Sign in to NMNH Platform",
  subtitleTg: "The academy bot issues your password",
  subtitleUid: "Sign in with your WEEX UID",
  subtitleCode: "Confirm the login with the code from Telegram",

  steps: [
    "1. Open the academy bot and tap “Log in to the site”.",
    "2. The bot checks your account and sends a password valid for five minutes.",
    "3. Enter it here.",
  ],
  openBot: "Open the academy bot",
  passLabel: "Password from the bot",
  passHint: "The dash and letter case don't matter.",
  passFailed: "That password didn't work",

  uidLabel: "Your WEEX UID",
  uidHint: "Where to find the UID: WEEX → Profile → UID (the numeric account id).",
  uidBackToBot: "← Sign in through the academy bot",
  uidFallbackNote: "This route is a last resort. The normal way in is the password from the academy bot.",
  noAccount: "No WEEX account?",
  registerLink: "Register →",
  uidNotFound: "This UID isn't in the system",
  requestCode: "Get the code",

  codeSentTo: "The code was sent to the Telegram bot",
  wrongCode: "Wrong code",
  changeUid: "Change UID",
  resend: "Send again",
  resendIn: (sec: number) => `Send again (${sec}s)`,

  success: "Done! Redirecting…",
  enter: "Sign in",
};
