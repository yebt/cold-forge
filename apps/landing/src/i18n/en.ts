/**
 * Landing-page copy (English is the source of truth).
 * `es` and `pt` are typed as `LandingCopy`, so a missing or extra key is a type error.
 * Shared domain copy (rank names, habit names, milestone titles, tagline) comes from `@cold-forge/i18n`.
 *
 * Template placeholders like `{n}` are filled at runtime (some of them client-side).
 */
export const en = {
  meta: {
    title: "COLD FORGE — Track your Winter Arc",
    description:
      "92 days. Oct 1 → Dec 31. Cold showers, gym, reading, early alarms. Check in with one tap, keep your streak alive and brag with story-ready cards.",
    ogLocale: "en_US",
  },
  a11y: {
    skip: "Skip to content",
    home: "COLD FORGE home",
    language: "Language",
    mainNav: "Main",
    phoneMock: "Preview of the COLD FORGE Today screen",
    cardMock: "Example of a COLD FORGE story share card",
  },
  nav: {
    how: "How it works",
    features: "Features",
    ranks: "Ranks",
    faq: "FAQ",
    cta: "Join waitlist",
  },
  hero: {
    eyebrow: "The Winter Arc tracker",
    titleA: "Forge yourself",
    titleB: "this winter.",
    sub: "92 days of cold showers, heavy lifts, early alarms and pages read. COLD FORGE turns every check-in into heat — and every streak into something worth posting.",
    appStore: "App Store",
    googlePlay: "Google Play",
    downloadOn: "Download on the",
    getItOn: "Get it on",
    comingSoon: "Coming soon",
    waitlist: "Join the waitlist",
    countdown: {
      label: "Winter Arc",
      fallback: "Oct 1 → Dec 31 · 92 days",
      upcoming: "{n} days until the Winter Arc",
      upcomingOne: "The Winter Arc starts tomorrow",
      upcomingSub: "Starts Oct 1. Pick your habits now.",
      active: "Day {day} of {total}",
      activeSub: "{n} days left to forge. Join in any day.",
      activeSubLast: "Final day. Finish strong.",
      finished: "The arc is over. See you next winter.",
      finishedSub: "{n} days until the next one.",
    },
  },
  phone: {
    today: "Today",
    heat: "Forge heat",
    done: "{done}/{total} done",
    tap: "Tap to forge",
  },
  how: {
    kicker: "How it works",
    title: "Less planning. More forging.",
    steps: [
      {
        title: "Pick your habits in 60 seconds",
        body: "Start from proven Winter Arc templates or write your own. No accounts, no setup maze.",
      },
      {
        title: "One tap a day",
        body: "Open, tap, done. Sparks fly, your phone buzzes and the forge gets hotter.",
      },
      {
        title: "Brag with story cards",
        body: "Turn your day count, streak and rank into a 9:16 card ready for your stories.",
      },
    ],
  },
  features: {
    kicker: "Features",
    title: "Built for 92 days of grind.",
    items: {
      checkins: {
        title: "One-tap check-ins",
        body: "Sparks and haptics on every tap. Logging a habit takes less time than reading this.",
      },
      streaks: {
        title: "Streaks & perfect days",
        body: "Every habit keeps its own streak. Hit them all and the day counts as perfect.",
      },
      heatmap: {
        title: "92-day heatmap",
        body: "Your whole arc at a glance — watch the grid go from cold to white-hot.",
      },
      ranks: {
        title: "Forge ranks",
        body: "Climb from {from} to {to} by stacking perfect days.",
      },
      cards: {
        title: "Story-ready share cards",
        body: "Day count, streak, rank and heatmap in one clean 9:16 card.",
      },
      reminders: {
        title: "Reminders",
        body: "A nudge at the time you choose, so the streak never dies by accident.",
      },
      offline: {
        title: "Offline-first",
        body: "Works in airplane mode, in the gym basement, everywhere. Your data stays on your phone.",
      },
      languages: {
        title: "3 languages",
        body: "English, Español and Português — switch any time.",
      },
    },
  },
  ranks: {
    kicker: "Forge ranks",
    title: "From raw ore to ice-forged.",
    sub: "Ranks are earned with perfect days — days where you checked every single habit. No shortcuts.",
    perfectDays: "{n} perfect days",
    start: "Where everyone starts",
  },
  share: {
    kicker: "Share cards",
    title: "Proof, not promises.",
    sub: "One tap turns your progress into a story-sized card. Post it, tag your crew, keep each other honest.",
    points: [
      "Sized 9:16 for Instagram, TikTok and WhatsApp stories",
      "Special cards on milestone days",
      "Your data, your call — nothing is posted for you",
    ],
    cardArc: "Winter Arc",
    streakDays: "{n} days",
  },
  habits: {
    kicker: "Habit ideas",
    title: "Stack the habits that scare you.",
    sub: "Start with a template or add your own. Most people forge 3 to 5.",
    custom: "Your own habit",
  },
  milestones: {
    kicker: "Milestones",
    title: "Checkpoints worth celebrating.",
    sub: "Hit one and you unlock a special share card.",
    day: "Day {n}",
  },
  faq: {
    kicker: "FAQ",
    title: "Questions, answered.",
    items: [
      {
        q: "What is the Winter Arc?",
        a: "A 92-day self-improvement challenge from October 1 to December 31. While everyone else hibernates, you build habits: cold showers, training, reading, waking early — whatever makes you harder to break.",
      },
      {
        q: "Is COLD FORGE free?",
        a: "Yes. Tracking, streaks, ranks and share cards are free. If we ever add extras, the core tracker stays free.",
      },
      {
        q: "Can I start late?",
        a: "Absolutely. Join the classic arc on any day, or start your own “my 92 days from today” arc whenever you’re ready.",
      },
      {
        q: "Which languages does it support?",
        a: "English, Spanish and Portuguese. It follows your phone’s language and you can switch any time.",
      },
      {
        q: "What happens to my data?",
        a: "It lives on your device. COLD FORGE works fully offline, needs no account and never sells your data. Share cards are only shared when you share them.",
      },
    ],
  },
  waitlist: {
    kicker: "Waitlist",
    title: "Be first in the forge.",
    sub: "Get a ping when COLD FORGE lands on the App Store and Google Play. One email, no spam.",
    label: "Email address",
    placeholder: "you@email.com",
    button: "Join the waitlist",
    thanks: "You’re on the list. Keep the fire going — we’ll email you at launch. 🔥",
    invalid: "That email doesn’t look right. Try again?",
    note: "We only use your email to tell you when the app launches.",
  },
  footer: {
    line: "Made for the cold months.",
    rights: "All rights reserved.",
    top: "Back to top",
  },
};

export type LandingCopy = typeof en;
