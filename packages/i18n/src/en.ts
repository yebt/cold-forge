const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * Source of truth for shared, domain-level copy. `es` and `pt` must match this shape,
 * so a missing translation is a type error. App-specific UI copy lives in each app.
 */
export const en = {
  appName: "COLD FORGE",
  tagline: "Forge yourself this winter.",
  days,
  ranks: {
    ore: "Raw Ore",
    iron: "Iron",
    steel: "Steel",
    tempered: "Tempered Steel",
    damascus: "Damascus",
    iceForged: "Ice-Forged",
  },
  habits: {
    coldShower: "Cold shower",
    gym: "Gym",
    read: "Read 20 min",
    wakeEarly: "Wake up early",
    noSugar: "No sugar",
    lessSocial: "Less social media",
    meditate: "Meditate",
    steps: "10k steps",
    water: "Drink 2L of water",
    journal: "Journal",
  },
  stats: {
    day: (day: number, total: number) => `Day ${day}/${total}`,
    perfectStreak: "Perfect streak",
    perfectDays: "Perfect days",
    completion: "Completion",
    rank: "Rank",
    toNextRank: (n: number, rank: string) => `${days(n)} to ${rank}`,
    maxRank: "Max rank reached",
  },
  milestones: {
    7: "First week forged",
    30: "30 days in the fire",
    50: "Halfway through the steel",
    75: "75 days unbroken",
    92: "Winter Arc complete",
  } as Record<number, string>,
  share: {
    upcoming: (title: string) => `❄️ ${title} — starting soon`,
    finished: (title: string, total: number) => `❄️ ${title} — COMPLETE (${days(total)})`,
    active: (title: string, day: number, total: number) => `❄️ ${title} — Day ${day}/${total}`,
    ofArc: (pct: number) => `${pct}% of the arc`,
    perfectStreak: (n: number) => `🔥 Perfect streak: ${days(n)}`,
    completion: (pct: number) => `✅ Completion: ${pct}%`,
    rank: (emoji: string, name: string) => `${emoji} Rank: ${name}`,
    habitLine: (emoji: string, name: string, streak: number, total: number) =>
      `${emoji} ${name} — ${streak}🔥 (${days(total)})`,
    footer: "Forged with COLD FORGE 🧊⚒️ #WinterArc",
  },
};

export type Messages = typeof en;
