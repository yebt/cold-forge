import type { Messages } from "./en.ts";

const days = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

export const pt: Messages = {
  appName: "COLD FORGE",
  tagline: "Forje-se neste inverno.",
  days,
  arcTitles: {
    winter: (year) => `Winter Arc ${year}`,
    custom: "Meus 92 dias",
  },
  ranks: {
    ore: "Minério bruto",
    iron: "Ferro",
    steel: "Aço",
    tempered: "Aço temperado",
    damascus: "Damasco",
    iceForged: "Forjado no gelo",
  },
  habits: {
    coldShower: "Banho gelado",
    gym: "Academia",
    read: "Ler 20 min",
    wakeEarly: "Acordar cedo",
    noSugar: "Sem açúcar",
    lessSocial: "Menos redes sociais",
    meditate: "Meditar",
    steps: "10 mil passos",
    water: "Beber 2L de água",
    journal: "Diário",
  },
  stats: {
    day: (day, total) => `Dia ${day}/${total}`,
    perfectStreak: "Sequência perfeita",
    perfectDays: "Dias perfeitos",
    completion: "Cumprimento",
    rank: "Nível",
    toNextRank: (n, rank) => `${days(n)} para ${rank}`,
    maxRank: "Nível máximo alcançado",
  },
  milestones: {
    7: "Primeira semana forjada",
    30: "30 dias no fogo",
    50: "Metade do aço",
    75: "75 dias inquebrável",
    92: "Winter Arc completo",
  },
  share: {
    upcoming: (title) => `❄️ ${title} — começa em breve`,
    finished: (title, total) => `❄️ ${title} — COMPLETO (${days(total)})`,
    active: (title, day, total) => `❄️ ${title} — Dia ${day}/${total}`,
    ofArc: (pct) => `${pct}% do arc`,
    perfectStreak: (n) => `🔥 Sequência perfeita: ${days(n)}`,
    completion: (pct) => `✅ Cumprimento: ${pct}%`,
    rank: (emoji, name) => `${emoji} Nível: ${name}`,
    habitLine: (emoji, name, streak, total) => `${emoji} ${name} — ${streak}🔥 (${days(total)})`,
    milestone: (title, day, arc) => `🏅 ${title} — Dia ${day} do meu ${arc}`,
    footer: "Forjado com COLD FORGE 🧊⚒️ #WinterArc",
  },
};
