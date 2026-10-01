/**
 * Landing-page copy (English is the source of truth).
 * `es` and `pt` are typed as `LandingCopy`, so a missing or extra key is a type error.
 * Shared domain copy (rank names, milestone titles, day counts) comes from `@cold-forge/i18n`.
 *
 * Template placeholders like `{n}` are filled with `fmt()` (the countdown ones client-side).
 */
export const en = {
  meta: {
    title: "COLD FORGE — While they hibernate, you forge",
    description:
      "The Winter Arc tracker. 92 days, Oct 1 → Dec 31: cold showers, training, reading, early alarms. One tap a day, streaks, ranks and story-ready cards. Free, no account, works offline.",
    ogLocale: "en_US",
  },
  a11y: {
    skip: "Skip to content",
    home: "COLD FORGE home",
    mainNav: "Main",
    language: "Language",
    forgeGrid: "A 92-day grid that turns from ice to ember",
    storyCard: "Example of a story share card",
    privacy: "Privacy",
  },
  nav: {
    deal: "The deal",
    arc: "The 92 days",
    faq: "FAQ",
    cta: "Start your arc",
  },
  hero: {
    eyebrow: "OCT 1 — DEC 31 · {days} DAYS",
    titleA: "While they",
    titleB: "hibernate,",
    titleC: "you forge.",
    sub: "92 days of cold, discipline and silence. Walk into January as someone else.",
    start: "Start your Winter Arc",
    apk: "Download APK",
    trust: "Free · no account · works offline",
    countdown: {
      /** Rendered before JS runs (and if it never does). */
      fallback: "days · Oct 1 to Dec 31",
      toJan: "days until January 1",
      toJanOne: "day until January 1",
      day: "Day {day} of {total}",
      toArc: "days until the Winter Arc",
      toArcOne: "day until the Winter Arc",
      toNext: "days until the next Winter Arc",
    },
  },
  deal: {
    kicker: "The deal",
    lines: ["Cold water at 6 a.m.", "Lifting when no one’s watching.", "Pages, not screens.", "Zero excuses"],
    end: "until December 31.",
    body: "Nobody is coming to do it for you. COLD FORGE asks for one thing: show up every day and check it off. Consistency does the rest.",
  },
  phases: {
    titleA: "Three months.",
    titleB: "Three versions of you.",
    sub: "The arc isn’t a straight line. First it hurts, then it’s routine, and by the end you’re someone else.",
    range: "{month} · days {from}–{to}",
    milestone: "Day {n} · {title}",
    milestonesLabel: "Milestones",
    items: [
      {
        month: "October",
        title: "The shock",
        body: "The water burns, the alarm weighs a ton. This is where most people quit. Your goal: one full first week.",
      },
      {
        month: "November",
        title: "The grind",
        body: "You stop negotiating with yourself. The dark comes earlier, and you’re already moving.",
      },
      {
        month: "December",
        title: "The forge",
        body: "While everyone promises “next year”, you already did it. You close the year with proof.",
      },
    ],
  },
  forge: {
    titleA: "From ice",
    titleB: "to",
    titleC: "ember.",
    sub: "Every square is a day of your arc. They start cold. Every day you show up heats them. By December, your grid should be on fire.",
    features: [
      "Check off your habits in one tap",
      "Per-habit streaks and perfect days",
      "{count} ranks, from {from} to {to}",
      "9:16 cards made for your stories",
    ],
  },
  proof: {
    titleA: "Proof,",
    titleB: "not promises.",
    body: "Everyone says this is the year. You’re going to show it, day by day. One tap turns your progress into a story ready to post.",
    note: "Illustrative example",
    streak: "{days} streak",
  },
  privacy: {
    items: [
      { title: "No account", body: "Everything lives on your phone." },
      { title: "Offline", body: "At the gym, on the subway, up the mountain." },
      { title: "No ads", body: "Nothing pulls you off your path." },
      { title: "Sync if you want", body: "With Google, across your devices." },
    ],
  },
  faq: {
    title: "Questions",
    items: [
      {
        q: "What is the Winter Arc?",
        a: "A 92-day challenge from October 1 to December 31: build discipline while the rest of the world slows down. You pick the habits — cold showers, training, reading, early alarms, whatever makes you harder to break.",
      },
      {
        q: "Can I start late?",
        a: "Yes. Join the official arc on any day, or start your own 92 days from today.",
      },
      {
        q: "Do I need an account?",
        a: "No. It works fully without signing up. Sign in with Google only if you want to sync across devices — your local progress comes with you.",
      },
      {
        q: "How much does it cost?",
        a: "Nothing. The web app and the Android APK are free, with no ads.",
      },
      {
        q: "Web app or APK?",
        a: "Same app, same features. The web app installs from your browser (Android: “Install app”; iPhone: Share → “Add to Home Screen”), updates itself and works offline. The APK is the Android build from our GitHub releases, if you prefer a classic app file.",
      },
      {
        q: "What happens to my data?",
        a: "Without an account, everything stays on your device. If you sign in, your habits and check-ins live in a private cloud space only you can read. Nothing is sold, and cards are only shared when you share them. You can export your data any time.",
      },
    ],
  },
  cta: {
    kicker: "January 1 comes either way",
    titleA: "Who will you be",
    titleB: "when it does?",
    start: "Start now — it’s free",
    apk: "or download the APK for Android",
  },
};

export type LandingCopy = typeof en;
