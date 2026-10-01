import type { ApiMessages } from "./en.ts";

export const pt: ApiMessages = {
  loginEmail: {
    subject: (app) => `Seu código para entrar no ${app}`,
    intro: (app) => `Use este código para entrar no ${app} e sincronizar seu progresso:`,
    linkIntro: "Ou abra este link no dispositivo onde você quer entrar:",
    button: "Entrar",
    expires: (minutes) => `O código e o link expiram em ${minutes} minutos e só funcionam uma vez.`,
    ignore: "Se você não pediu isso, ignore este e-mail. Ninguém consegue entrar sem o código.",
    neverShare: "Não compartilhe este código. Nunca vamos pedi-lo a você.",
  },
};
