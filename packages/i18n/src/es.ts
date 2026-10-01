import type { Messages } from "./en.ts";

const days = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

export const es: Messages = {
  appName: "COLD FORGE",
  tagline: "Fórjate este invierno.",
  days,
  ranks: {
    ore: "Mineral crudo",
    iron: "Hierro",
    steel: "Acero",
    tempered: "Acero templado",
    damascus: "Damasco",
    iceForged: "Forjado en hielo",
  },
  habits: {
    coldShower: "Ducha fría",
    gym: "Gym",
    read: "Leer 20 min",
    wakeEarly: "Despertar temprano",
    noSugar: "Sin azúcar",
    lessSocial: "Menos redes",
    meditate: "Meditar",
    steps: "10k pasos",
    water: "Tomar 2L de agua",
    journal: "Diario",
  },
  stats: {
    day: (day, total) => `Día ${day}/${total}`,
    perfectStreak: "Racha perfecta",
    perfectDays: "Días perfectos",
    completion: "Cumplimiento",
    rank: "Rango",
    toNextRank: (n, rank) => `${days(n)} para ${rank}`,
    maxRank: "Rango máximo alcanzado",
  },
  milestones: {
    7: "Primera semana forjada",
    30: "30 días en el fuego",
    50: "A mitad del acero",
    75: "75 días sin romperte",
    92: "Winter Arc completado",
  },
  share: {
    upcoming: (title) => `❄️ ${title} — empieza pronto`,
    finished: (title, total) => `❄️ ${title} — COMPLETADO (${days(total)})`,
    active: (title, day, total) => `❄️ ${title} — Día ${day}/${total}`,
    ofArc: (pct) => `${pct}% del arc`,
    perfectStreak: (n) => `🔥 Racha perfecta: ${days(n)}`,
    completion: (pct) => `✅ Cumplimiento: ${pct}%`,
    rank: (emoji, name) => `${emoji} Rango: ${name}`,
    habitLine: (emoji, name, streak, total) => `${emoji} ${name} — ${streak}🔥 (${days(total)})`,
    footer: "Forjado con COLD FORGE 🧊⚒️ #WinterArc",
  },
};
