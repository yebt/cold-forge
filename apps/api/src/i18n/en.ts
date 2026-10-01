/**
 * API-only copy (emails). `es` and `pt` are typed against this object, so a missing
 * translation is a compile error. Interpolated values are HTML-escaped by the mailer.
 */
export const en = {
  loginEmail: {
    subject: (app: string) => `Your ${app} sign-in code`,
    intro: (app: string) => `Use this code to sign in to ${app} and sync your progress:`,
    linkIntro: "Or open this link on the device where you want to sign in:",
    button: "Sign in",
    expires: (minutes: number) => `The code and the link expire in ${minutes} minutes and work only once.`,
    ignore: "If you didn't ask for this, ignore this email. Nobody can sign in without the code.",
    neverShare: "Never share this code. We will never ask you for it.",
  },
};

export type ApiMessages = typeof en;
