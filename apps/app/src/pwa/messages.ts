import { detectLocale, type Locale } from "@cold-forge/i18n";

/** PWA copy lives here (not in the app dictionaries) so this module stays self-contained. */
const en = {
  updateAvailable: "New version available",
  reload: "Reload",
  later: "Later",
  offlineReady: "Ready to work offline",
  installTitle: "Install COLD FORGE",
  installBody: "Add it to your home screen: opens full screen, works offline, no store needed.",
  install: "Install app",
  notNow: "Not now",
  iosHow: "How to install",
  iosTitle: "Add to Home Screen",
  iosStep1: "Tap the Share button {icon} in Safari’s toolbar.",
  iosStep2: "Scroll down and tap “Add to Home Screen”.",
  iosStep3: "Tap “Add”. COLD FORGE opens from your home screen like any app.",
  iosNote: "On iPhone, web apps can’t schedule reminders while closed.",
  close: "Close",
  gotIt: "Got it",
};

export type PwaMessages = typeof en;

const es: PwaMessages = {
  updateAvailable: "Nueva versión disponible",
  reload: "Recargar",
  later: "Luego",
  offlineReady: "Lista para usarse sin conexión",
  installTitle: "Instala COLD FORGE",
  installBody: "Añádela a tu pantalla de inicio: pantalla completa, funciona sin conexión y sin tienda de apps.",
  install: "Instalar app",
  notNow: "Ahora no",
  iosHow: "Cómo instalar",
  iosTitle: "Añadir a pantalla de inicio",
  iosStep1: "Toca el botón Compartir {icon} en la barra de Safari.",
  iosStep2: "Desliza y toca “Añadir a pantalla de inicio”.",
  iosStep3: "Toca “Añadir”. COLD FORGE se abre desde tu pantalla de inicio como cualquier app.",
  iosNote: "En iPhone, las apps web no pueden programar recordatorios con la app cerrada.",
  close: "Cerrar",
  gotIt: "Entendido",
};

const pt: PwaMessages = {
  updateAvailable: "Nova versão disponível",
  reload: "Recarregar",
  later: "Depois",
  offlineReady: "Pronto para usar offline",
  installTitle: "Instale o COLD FORGE",
  installBody: "Adicione à tela de início: abre em tela cheia, funciona offline e sem loja de apps.",
  install: "Instalar app",
  notNow: "Agora não",
  iosHow: "Como instalar",
  iosTitle: "Adicionar à Tela de Início",
  iosStep1: "Toque no botão Compartilhar {icon} na barra do Safari.",
  iosStep2: "Role para baixo e toque em “Adicionar à Tela de Início”.",
  iosStep3: "Toque em “Adicionar”. O COLD FORGE abre da tela de início como qualquer app.",
  iosNote: "No iPhone, apps web não conseguem agendar lembretes com o app fechado.",
  close: "Fechar",
  gotIt: "Entendi",
};

/** Typed against `en`, so a missing or extra key in es/pt is a type error. */
export const PWA_MESSAGES: Record<Locale, PwaMessages> = { en, es, pt };

/** The app writes the active locale to `<html lang>`; before that, fall back to the browser languages. */
export function pwaLocale(
  htmlLang: string | null | undefined = typeof document === "undefined" ? null : document.documentElement.lang,
  languages: readonly string[] = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]),
): Locale {
  return htmlLang ? detectLocale([htmlLang, ...languages]) : detectLocale(languages);
}
