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
    cta: "Lista de espera",
  },
  hero: {
    eyebrow: "El tracker del Winter Arc",
    titleA: "Fórjate",
    titleB: "este invierno.",
    sub: "92 días de duchas frías, pesas, alarmas tempranas y páginas leídas. COLD FORGE convierte cada check-in en calor, y cada racha en algo que vale la pena presumir.",
    appStore: "App Store",
    googlePlay: "Google Play",
    downloadOn: "Descárgalo en",
    getItOn: "Disponible en",
    comingSoon: "Muy pronto",
    waitlist: "Únete a la lista",
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
        body: "En modo avión, en el sótano del gym, donde sea. Tus datos se quedan en tu teléfono.",
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
        q: "¿Puedo empezar tarde?",
        a: "Claro. Súmate al arc clásico cualquier día o arranca tu propio arc de “mis 92 días desde hoy” cuando estés listo.",
      },
      {
        q: "¿En qué idiomas está?",
        a: "Inglés, español y portugués. Usa el idioma de tu teléfono y puedes cambiarlo cuando quieras.",
      },
      {
        q: "¿Qué pasa con mis datos?",
        a: "Viven en tu dispositivo. COLD FORGE funciona sin conexión, no necesita cuenta y nunca vende tus datos. Las tarjetas solo se comparten cuando tú las compartes.",
      },
    ],
  },
  waitlist: {
    kicker: "Lista de espera",
    title: "Sé el primero en la forja.",
    sub: "Te avisamos cuando COLD FORGE llegue a App Store y Google Play. Un correo, cero spam.",
    label: "Correo electrónico",
    placeholder: "tu@correo.com",
    button: "Unirme a la lista",
    thanks: "Ya estás en la lista. Mantén el fuego encendido: te escribimos en el lanzamiento. 🔥",
    invalid: "Ese correo no se ve bien. ¿Lo intentas de nuevo?",
    note: "Solo usamos tu correo para avisarte cuando salga la app.",
  },
  footer: {
    line: "Hecho para los meses fríos.",
    rights: "Todos los derechos reservados.",
    top: "Volver arriba",
  },
};
