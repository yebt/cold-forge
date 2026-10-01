import type { LandingCopy } from "./en.ts";

export const es: LandingCopy = {
  meta: {
    title: "COLD FORGE — Mientras ellos hibernan, tú te forjas",
    description:
      "El tracker del Winter Arc. 92 días, del 1 de octubre al 31 de diciembre: duchas frías, gym, lectura, madrugar. Un toque al día, rachas, rangos y tarjetas para tus historias. Gratis, sin cuenta y sin conexión.",
    ogLocale: "es_ES",
  },
  a11y: {
    skip: "Saltar al contenido",
    home: "Inicio de COLD FORGE",
    mainNav: "Principal",
    language: "Idioma",
    forgeGrid: "Cuadrícula de 92 días que pasa del hielo a la brasa",
    storyCard: "Ejemplo de tarjeta para historias",
    privacy: "Privacidad",
  },
  nav: {
    deal: "El trato",
    arc: "Los 92 días",
    faq: "Preguntas",
    cta: "Empieza tu arc",
  },
  hero: {
    eyebrow: "01.10 — 31.12 · {days} DÍAS",
    titleA: "Mientras ellos",
    titleB: "hibernan,",
    titleC: "tú te forjas.",
    sub: "92 días de frío, disciplina y silencio. Llega a enero siendo otra persona.",
    start: "Empieza tu Winter Arc",
    apk: "Descargar APK",
    trust: "Gratis · sin cuenta · funciona sin conexión",
    countdown: {
      fallback: "días · del 1 de octubre al 31 de diciembre",
      toJan: "días para el 1 de enero",
      toJanOne: "día para el 1 de enero",
      day: "Día {day} de {total}",
      toArc: "días para el Winter Arc",
      toArcOne: "día para el Winter Arc",
      toNext: "días para el próximo Winter Arc",
    },
  },
  deal: {
    kicker: "El trato",
    lines: ["Agua fría a las 6:00.", "Pesas cuando nadie mira.", "Páginas en vez de pantallas.", "Cero excusas"],
    end: "hasta el 31 de diciembre.",
    body: "Nadie va a venir a hacerlo por ti. COLD FORGE solo te pide una cosa: aparecer cada día y marcarlo. El resto lo hace la constancia.",
  },
  phases: {
    titleA: "Tres meses.",
    titleB: "Tres versiones de ti.",
    sub: "El arc no es lineal. Al principio duele, después se vuelve rutina y al final ya eres otro.",
    range: "{month} · días {from}–{to}",
    milestone: "Día {n} · {title}",
    milestonesLabel: "Hitos",
    items: [
      {
        month: "Octubre",
        title: "El impacto",
        body: "El agua quema, la alarma pesa. Aquí se queda la mayoría. Tu meta: la primera semana completa.",
      },
      {
        month: "Noviembre",
        title: "La rutina",
        body: "Ya no negocias contigo. Los días oscuros llegan antes y tú ya estás en movimiento.",
      },
      {
        month: "Diciembre",
        title: "La forja",
        body: "Mientras todos prometen “el próximo año”, tú ya lo hiciste. Cierras el año con pruebas.",
      },
    ],
  },
  forge: {
    titleA: "Del hielo",
    titleB: "a la",
    titleC: "brasa.",
    sub: "Cada cuadro es un día de tu arc. Empiezan fríos. Cada día cumplido los calienta. En diciembre, tu cuadrícula debería arder.",
    features: [
      "Marca tus hábitos en un toque",
      "Rachas por hábito y días perfectos",
      "{count} rangos, de {from} a {to}",
      "Tarjetas 9:16 para presumir en historias",
    ],
  },
  proof: {
    titleA: "Pruebas,",
    titleB: "no promesas.",
    body: "Todos dicen que este año sí. Tú lo vas a enseñar, día por día. Con un toque, tu progreso se vuelve una historia lista para publicar.",
    note: "Ejemplo ilustrativo",
    streak: "racha de {days}",
  },
  privacy: {
    items: [
      { title: "Sin cuenta", body: "Todo se guarda en tu teléfono." },
      { title: "Sin conexión", body: "En el gym, en el metro, en la montaña." },
      { title: "Sin anuncios", body: "Nada te distrae de lo tuyo." },
      { title: "Sincroniza si quieres", body: "Con Google, entre tus dispositivos." },
    ],
  },
  faq: {
    title: "Preguntas",
    items: [
      {
        q: "¿Qué es el Winter Arc?",
        a: "Un reto de 92 días, del 1 de octubre al 31 de diciembre: construir disciplina mientras el resto del mundo baja el ritmo. Tú eliges los hábitos: duchas frías, entrenar, leer, madrugar… lo que te haga más difícil de romper.",
      },
      {
        q: "¿Puedo empezar tarde?",
        a: "Sí. Únete al arc oficial cuando quieras, o empieza tus propios 92 días desde hoy.",
      },
      {
        q: "¿Necesito una cuenta?",
        a: "No. Funciona completa sin registro. Solo entras con Google si quieres sincronizar entre dispositivos, y tu progreso local se va contigo.",
      },
      {
        q: "¿Cuánto cuesta?",
        a: "Nada. La app web y el APK para Android son gratuitos y sin anuncios.",
      },
      {
        q: "¿App web o APK?",
        a: "Es la misma app, con las mismas funciones. La app web se instala desde el navegador (Android: “Instalar app”; iPhone: Compartir → “Añadir a pantalla de inicio”), se actualiza sola y funciona sin conexión. El APK es la versión para Android de nuestras releases en GitHub, por si prefieres un archivo de app clásico.",
      },
      {
        q: "¿Qué pasa con mis datos?",
        a: "Sin cuenta, todo se queda en tu dispositivo. Si inicias sesión, tus hábitos y check-ins viven en un espacio privado en la nube que solo tú puedes leer. No se vende nada y las tarjetas solo se comparten cuando tú las compartes. Puedes exportar tus datos cuando quieras.",
      },
    ],
  },
  cta: {
    kicker: "El 1 de enero llega igual",
    titleA: "¿Quién vas a ser",
    titleB: "cuando llegue?",
    start: "Empezar ahora — es gratis",
    apk: "o descarga el APK para Android",
  },
};
