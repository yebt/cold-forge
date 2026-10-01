import { MILESTONE_DAYS, diffDays, type ISODate } from "@cold-forge/core";
import { isLocale } from "@cold-forge/i18n";
import {
  checkInKey as syncCheckInKey,
  incomingWins,
  type SyncArc,
  type SyncChanges,
  type SyncCheckIn,
  type SyncHabit,
  type SyncProfile,
} from "@cold-forge/sync";
import {
  SCHEMA_VERSION,
  checkInKey,
  defaultSettings,
  profileUpdatedAt,
  type AppData,
  type CheckInRecord,
  type Settings,
  type StoredArc,
  type StoredHabit,
} from "../model.ts";

/**
 * Arcs that are not the current one, with their habits and check-ins. Kept locally so nothing is
 * lost when the current arc changes (another device started a new arc, or a sign-in conflict).
 */
export interface History {
  arcs: SyncArc[];
  habits: SyncHabit[];
  checkIns: SyncCheckIn[];
}

export const emptyHistory = (): History => ({ arcs: [], habits: [], checkIns: [] });

// ---- AppData -> wire records ----

export function toSyncArc(arc: StoredArc): SyncArc {
  return {
    id: arc.id,
    kind: arc.kind,
    startDate: arc.startDate,
    endDate: arc.endDate,
    why: arc.why,
    createdAt: arc.createdAt,
    updatedAt: arc.updatedAt,
  };
}

export function toSyncHabit(h: StoredHabit, arcId: string): SyncHabit {
  return {
    id: h.id,
    arcId,
    ...(h.templateId ? { templateId: h.templateId } : {}),
    name: h.name,
    emoji: h.emoji,
    order: h.order,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    ...(h.deletedAt ? { deletedAt: h.deletedAt } : {}),
  };
}

export function toSyncCheckIn(c: CheckInRecord): SyncCheckIn {
  return { habitId: c.habitId, date: c.date, done: c.done, updatedAt: c.updatedAt };
}

export function toSyncProfile(data: AppData): SyncProfile {
  return {
    displayName: data.settings.displayName,
    locale: data.settings.locale,
    currentArcId: data.arc.id,
    updatedAt: profileUpdatedAt(data.settings),
  };
}

/** The current arc's records. Device-only prefs (sound, haptics, reminders, milestones) are not synced. */
export function toSyncChanges(data: AppData): SyncChanges {
  return {
    arcs: [toSyncArc(data.arc)],
    habits: data.habits.map((h) => toSyncHabit(h, data.arc.id)),
    checkIns: Object.values(data.checkIns).map(toSyncCheckIn),
    profile: toSyncProfile(data),
  };
}

/** Every record this device holds: the current arc plus history. */
export function localRecords(data: AppData | null, history: History): SyncChanges {
  const current = data ? toSyncChanges(data) : { arcs: [], habits: [], checkIns: [], profile: null };
  return {
    arcs: [...current.arcs, ...history.arcs],
    habits: [...current.habits, ...history.habits],
    checkIns: [...current.checkIns, ...history.checkIns],
    profile: current.profile,
  };
}

// ---- Merge ----

interface Versioned {
  updatedAt: string;
}

/** LWW-merges `incoming` into `map`; returns the records that won. */
function mergeInto<T extends Versioned>(map: Map<string, T>, incoming: readonly T[], key: (r: T) => string): T[] {
  const won: T[] = [];
  for (const r of incoming) {
    const k = key(r);
    if (incomingWins(map.get(k), r)) {
      map.set(k, r);
      won.push(r);
    }
  }
  return won;
}

export interface ApplyOptions {
  today: ISODate;
  now: string;
  /** Use this arc as current regardless of the profile (used to resolve a sign-in conflict). */
  forceCurrentArcId?: string;
  /** The incoming profile replaces the local one even if it isn't newer ("use the account's arc"). */
  incomingProfileWins?: boolean;
  /**
   * With no local data, don't bring an arc onto the device (the user is onboarding a new arc,
   * maybe right after "Reset arc"); just keep the records as history.
   */
  keepEmpty?: boolean;
}

export interface ApplyResult {
  data: AppData | null;
  history: History;
  /** True when `data` differs from the input (some record won, or the current arc switched). */
  changed: boolean;
  historyChanged: boolean;
}

function milestonesReached(arc: SyncArc, today: ISODate): number[] {
  const day = diffDays(arc.startDate, today) + 1;
  return MILESTONE_DAYS.filter((d) => d <= day);
}

function settingsFor(data: AppData | null, profile: SyncProfile | null, now: string): Settings {
  const locale = profile && isLocale(profile.locale) ? profile.locale : (data?.settings.locale ?? "en");
  const base = data?.settings ?? defaultSettings(locale, now);
  if (!profile) return base;
  return { ...base, displayName: profile.displayName, locale, profileUpdatedAt: profile.updatedAt };
}

/**
 * Merges server records into this device's data, last-write-wins per record. Only the current
 * arc (the profile's `currentArcId`, else the local one) is materialized into AppData; records of
 * other arcs go to `history`.
 */
export function applyRemote(
  data: AppData | null,
  history: History,
  incoming: SyncChanges,
  opts: ApplyOptions,
): ApplyResult {
  const local = localRecords(data, history);
  const arcs = new Map(local.arcs.map((a) => [a.id, a]));
  const habits = new Map(local.habits.map((h) => [h.id, h]));
  const checkIns = new Map(local.checkIns.map((c) => [syncCheckInKey(c), c]));
  const wonArcs = mergeInto(arcs, incoming.arcs, (a) => a.id);
  const wonHabits = mergeInto(habits, incoming.habits, (h) => h.id);
  const wonCheckIns = mergeInto(checkIns, incoming.checkIns, syncCheckInKey);
  const wins = wonArcs.length + wonHabits.length + wonCheckIns.length;
  let profile = local.profile;
  let profileWon = false;
  if (incoming.profile && (opts.incomingProfileWins || incomingWins(profile ?? undefined, incoming.profile))) {
    profile = incoming.profile;
    profileWon = true;
  }

  const usable = (id: string | null | undefined): id is string => !!id && !!arcs.get(id) && !arcs.get(id)!.deletedAt;
  let currentId: string | null = null;
  if (!data && opts.keepEmpty) currentId = null;
  else if (usable(opts.forceCurrentArcId)) currentId = opts.forceCurrentArcId;
  else if (usable(profile?.currentArcId)) currentId = profile!.currentArcId;
  else if (data && arcs.has(data.arc.id)) currentId = data.arc.id;

  if (!currentId) {
    // Nothing to show yet (no local arc and the account has none): keep everything as history.
    return {
      data,
      history: { arcs: [...arcs.values()], habits: [...habits.values()], checkIns: [...checkIns.values()] },
      changed: false,
      historyChanged: wins > 0,
    };
  }

  const arc = arcs.get(currentId)!;
  const currentHabits = [...habits.values()].filter((h) => h.arcId === currentId);
  const currentHabitIds = new Set(currentHabits.map((h) => h.id));
  const switched = !data || data.arc.id !== currentId;

  const settings = settingsFor(data, profile, opts.now);
  // The profile must name the arc we show; if it doesn't (e.g. it pointed at a deleted arc),
  // bump it so this device's choice is pushed.
  if (!profile || profile.currentArcId !== currentId) settings.profileUpdatedAt = opts.now;

  const storedArc: StoredArc = {
    id: arc.id,
    kind: arc.kind,
    startDate: arc.startDate,
    endDate: arc.endDate,
    why: arc.why,
    createdAt: arc.createdAt,
    updatedAt: arc.updatedAt,
  };
  const storedHabits: StoredHabit[] = currentHabits.map((h) => ({
    id: h.id,
    ...(h.templateId ? { templateId: h.templateId } : {}),
    name: h.name,
    emoji: h.emoji,
    order: h.order,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    ...(h.deletedAt ? { deletedAt: h.deletedAt } : {}),
  }));
  const storedCheckIns: Record<string, CheckInRecord> = {};
  const nextHistory: History = { arcs: [], habits: [], checkIns: [] };
  for (const c of checkIns.values()) {
    if (currentHabitIds.has(c.habitId)) storedCheckIns[checkInKey(c.habitId, c.date)] = { ...c };
    else nextHistory.checkIns.push(c);
  }
  for (const a of arcs.values()) if (a.id !== currentId) nextHistory.arcs.push(a);
  for (const h of habits.values()) if (h.arcId !== currentId) nextHistory.habits.push(h);

  const next: AppData = {
    version: SCHEMA_VERSION,
    arc: storedArc,
    habits: storedHabits,
    checkIns: storedCheckIns,
    settings,
    celebratedMilestones: !switched && data ? data.celebratedMilestones : milestonesReached(arc, opts.today),
  };
  const historyChanged =
    switched ||
    nextHistory.arcs.length !== history.arcs.length ||
    nextHistory.habits.length !== history.habits.length ||
    nextHistory.checkIns.length !== history.checkIns.length ||
    wins > 0;
  const currentWins =
    wonArcs.some((a) => a.id === currentId) ||
    wonHabits.some((h) => h.arcId === currentId) ||
    wonCheckIns.some((c) => currentHabitIds.has(c.habitId));
  const changed =
    switched ||
    currentWins ||
    (profileWon && (profile!.displayName !== data?.settings.displayName || profile!.locale !== data?.settings.locale)) ||
    settings.profileUpdatedAt !== data?.settings.profileUpdatedAt;
  return { data: changed ? next : data, history: historyChanged ? nextHistory : history, changed, historyChanged };
}
