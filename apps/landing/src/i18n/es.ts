import type { LandingCopy } from "./en.ts";

/** Latin-American neutral Spanish. */
export const es: LandingCopy = {
  meta: {
    title: "COLD FORGE — Trackea tu Winter Arc",
    description:
      "92 días. Del 1 de oct al 31 de dic. Duchas frías, gym, lectura, madrugadas. Marca tus hábitos con un toque, cuida tu racha y presume con tarjetas listas para tus historias.",
    ogLocale: "es_LA",
  },
  a11y: {
    skip: "Saltar al contenido",
    home: "Inicio de COLD FORGE",
    language: "Idioma",
    mainNav: "Principal",
    phoneMock: "Vista previa de la pantalla Hoy de COLD FORGE",
    cardMock: "Ejemplo de una tarjeta para historias de COLD FORGE",
  },
  nav: {
    how: "Cómo funciona",
    features: "Funciones",
    ranks: "Rangos",
    faq: "Preguntas",
    cta: "Abrir la app",
  },
  hero: {
    eyebrow: "El tracker del Winter Arc",
    titleA: "Fórjate",
    titleB: "este invierno.",
    sub: "92 días de duchas frías, pesas, alarmas tempranas y páginas leídas. COLD FORGE convierte cada check-in en calor, y cada racha en algo que vale la pena presumir.",
    openApp: "Abrir la app web",
    openAppNote: "Se instala como una app · funciona sin conexión · sin tienda",
    apk: "Descargar APK",
    apkPlatform: "Android",
    apkNote: "¿Prefieres la app web? Es la misma app.",
    storesLater: "App Store y Google Play: más adelante.",
    countdown: {
      label: "Winter Arc",
      fallback: "1 oct → 31 dic · 92 días",
      upcoming: "Faltan {n} días para el Winter Arc",
      upcomingOne: "El Winter Arc empieza mañana",
      upcomingSub: "Arranca el 1 de octubre. Elige tus hábitos ya.",
      active: "Día {day} de {total}",
      activeSub: "Quedan {n} días para forjarte. Súmate cuando quieras.",
      activeSubLast: "Último día. Cierra fuerte.",
      finished: "El arc terminó. Nos vemos el próximo invierno.",
      finishedSub: "Faltan {n} días para el siguiente.",
    },
  },
  phone: {
    today: "Hoy",
    heat: "Calor de forja",
    done: "{done}/{total} listos",
    tap: "Toca para forjar",
  },
  how: {
    kicker: "Cómo funciona",
    title: "Menos planear. Más forjar.",
    steps: [
      {
        title: "Elige tus hábitos en 60 segundos",
        body: "Parte de plantillas probadas del Winter Arc o crea las tuyas. Sin cuentas ni configuraciones eternas.",
      },
      {
        title: "Un toque al día",
        body: "Abres, tocas, listo. Saltan chispas, vibra el teléfono y la forja se calienta.",
      },
      {
        title: "Presume con tarjetas para historias",
        body: "Tu día, tu racha y tu rango en una tarjeta 9:16 lista para tus historias.",
      },
    ],
  },
  features: {
    kicker: "Funciones",
    title: "Hecho para 92 días de disciplina.",
    items: {
      checkins: {
        title: "Check-ins de un toque",
        body: "Chispas y vibración en cada toque. Marcar un hábito toma menos que leer esto.",
      },
      streaks: {
        title: "Rachas y días perfectos",
        body: "Cada hábito tiene su propia racha. Cúmplelos todos y el día cuenta como perfecto.",
      },
      heatmap: {
        title: "Mapa de calor de 92 días",
        body: "Todo tu arc de un vistazo: mira cómo la cuadrícula pasa de fría a candente.",
      },
      ranks: {
        title: "Rangos de forja",
        body: "Sube de {from} a {to} sumando días perfectos.",
      },
      cards: {
        title: "Tarjetas para historias",
        body: "Día, racha, rango y mapa de calor en una tarjeta 9:16 impecable.",
      },
      reminders: {
        title: "Recordatorios",
        body: "Un aviso a la hora que elijas, para que la racha nunca muera por descuido.",
      },
      offline: {
        title: "Funciona sin conexión",
        body: "En modo avión, en el sótano del gym, donde sea. Sin cuenta: inicia sesión con Google solo si quieres sincronizar.",
      },
      languages: {
        title: "3 idiomas",
        body: "English, Español y Português. Cámbialo cuando quieras.",
      },
    },
  },
  ranks: {
    kicker: "Rangos de forja",
    title: "De mineral crudo a forjado en hielo.",
    sub: "Los rangos se ganan con días perfectos: días en los que marcaste todos tus hábitos. Sin atajos.",
    perfectDays: "{n} días perfectos",
    start: "Aquí empiezan todos",
  },
  share: {
    kicker: "Tarjetas para compartir",
    title: "Pruebas, no promesas.",
    sub: "Con un toque, tu progreso se vuelve una tarjeta del tamaño de una historia. Publícala, etiqueta a tu equipo y mantengan el compromiso.",
    points: [
      "Formato 9:16 para historias de Instagram, TikTok y WhatsApp",
      "Tarjetas especiales en los días hito",
      "Tus datos, tu decisión: nada se publica sin ti",
    ],
    cardArc: "Winter Arc",
    streakDays: "{n} días",
  },
  habits: {
    kicker: "Ideas de hábitos",
    title: "Suma los hábitos que te dan miedo.",
    sub: "Empieza con una plantilla o agrega los tuyos. La mayoría forja entre 3 y 5.",
    custom: "Tu propio hábito",
  },
  milestones: {
    kicker: "Hitos",
    title: "Metas que vale la pena celebrar.",
    sub: "Alcanza una y desbloqueas una tarjeta especial para compartir.",
    day: "Día {n}",
  },
  faq: {
    kicker: "Preguntas",
    title: "Preguntas frecuentes.",
    items: [
      {
        q: "¿Qué es el Winter Arc?",
        a: "Un reto de superación de 92 días, del 1 de octubre al 31 de diciembre. Mientras los demás hibernan, tú construyes hábitos: duchas frías, entrenamiento, lectura, madrugar… lo que te haga más difícil de romper.",
      },
      {
        q: "¿COLD FORGE es gratis?",
        a: "Sí. El seguimiento, las rachas, los rangos y las tarjetas son gratis. Si algún día sumamos extras, lo esencial seguirá siendo gratis.",
      },
      {
        q: "¿Cómo la instalo?",
        a: "Abre la app web. Android (Chrome): toca “Instalar app” o ⋮ → “Instalar app”. iPhone/iPad (Safari): toca Compartir → “Añadir a pantalla de inicio”. Computadora (Chrome o Edge): haz clic en el icono de instalar de la barra de direcciones. Luego se abre a pantalla completa desde tu inicio o dock, como cualquier app.",
      },
      {
        q: "¿App web o APK?",
        a: "Es la misma app, con las mismas funciones. La app web se instala en segundos, se actualiza sola y funciona en cualquier teléfono o computadora. El APK es la versión para Android de nuestras releases en GitHub, por si prefieres un archivo de app clásico; Android te pedirá permitir instalaciones desde tu navegador.",
      },
      {
        q: "¿Necesito una cuenta?",
        a: "No. COLD FORGE funciona completa sin cuenta (modo invitado). Inicia sesión con Google solo si quieres sincronizar tu arc entre dispositivos: puedes hacerlo cuando quieras y tu progreso local se va contigo.",
      },
      {
        q: "¿Qué pasa con mis datos?",
        a: "Sin cuenta, todo se queda en tu dispositivo y funciona sin conexión. Si inicias sesión, tus hábitos y check-ins se guardan en tu espacio privado en la nube, que solo tú puedes leer. Sin anuncios, nada se vende y las tarjetas solo se comparten cuando tú las compartes. Puedes exportar tus datos cuando quieras.",
      },
      {
        q: "¿Puedo empezar tarde?",
        a: "Claro. Súmate al arc clásico cualquier día o arranca tu propio arc de “mis 92 días desde hoy” cuando estés listo.",
      },
      {
        q: "¿En qué idiomas está?",
        a: "Inglés, español y portugués. Usa el idioma de tu dispositivo y puedes cambiarlo cuando quieras.",
      },
    ],
  },
  install: {
    kicker: "Consigue la app",
    title: "Se instala en segundos. Sin tienda.",
    sub: "COLD FORGE es una app web que puedes instalar: se abre a pantalla completa desde tu inicio, funciona sin conexión y se actualiza sola.",
    open: "Abrir la app web",
    apk: "Descargar APK (Android)",
    apkNote: "¿Prefieres la app web? Es la misma app.",
    guest: "Sin cuenta. Iniciar sesión con Google es opcional, solo para sincronizar entre dispositivos.",
    platforms: [
      {
        name: "Android",
        steps: ["Abre la app web en Chrome.", "Toca “Instalar app” (o ⋮ → “Instalar app”).", "Busca COLD FORGE en tu pantalla de inicio."],
      },
      {
        name: "iPhone y iPad",
        steps: ["Abre la app web en Safari.", "Toca Compartir y luego “Añadir a pantalla de inicio”.", "Toca “Añadir” y listo."],
      },
      {
        name: "Computadora",
        steps: ["Abre la app web en Chrome o Edge.", "Haz clic en el icono de instalar de la barra de direcciones.", "Ábrela desde tu dock o menú de inicio."],
      },
    ],
  },
  footer: {
    line: "Hecho para los meses fríos.",
    rights: "Todos los derechos reservados.",
    top: "Volver arriba",
  },
};
