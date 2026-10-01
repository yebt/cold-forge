import type { ApiMessages } from "./en.ts";

export const es: ApiMessages = {
  loginEmail: {
    subject: (app) => `Tu código para entrar a ${app}`,
    intro: (app) => `Usa este código para entrar a ${app} y sincronizar tu progreso:`,
    linkIntro: "O abre este enlace en el dispositivo donde quieres entrar:",
    button: "Entrar",
    expires: (minutes) => `El código y el enlace caducan en ${minutes} minutos y solo sirven una vez.`,
    ignore: "Si no lo pediste, ignora este correo. Nadie puede entrar sin el código.",
    neverShare: "No compartas este código. Nunca te lo vamos a pedir.",
  },
};
