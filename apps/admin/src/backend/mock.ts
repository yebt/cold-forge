/**
 * DEV-ONLY fixture backend (`bun run dev:mock`). Imported solely behind
 * `import.meta.env.DEV && VITE_ADMIN_MOCK === "1"`, so production builds drop it entirely
 * (verified by `bun run check:bundle`). Mirrors the server's rules closely enough to exercise the UI.
 */
import type {
  AdminCallableName,
  AdminCallables,
  AuditEntryDto,
  ListUsersResponse,
  StatsResponse,
  UserDetailResponse,
  UserRowDto,
} from "./types.ts";
import { CallError, type AuthState, type Backend, type Session } from "./types.ts";

const NAMES = [
  "Sofía Ramírez", "Liam Carter", "Mateus Oliveira", "Ava Thompson", "Diego Fernández", "Noah Kim",
  "Valentina Rossi", "Ethan Brooks", "Camila Torres", "Lucas Martin", "Isabela Costa", "Mason Reed",
  "Lucía Gómez", "Oliver Hughes", "Gabriel Souza", "Emma Wilson", "Andrés Morales", "Mia Johnson",
  "Pedro Almeida", "Harper Lee", "Martina López", "James Walker", "Beatriz Lima", "Elijah Scott",
  "Renata Silva", "Benjamin Young", "Daniela Ruiz", "Henry Adams", "Julia Pereira", "Jack Turner",
  "Paula Navarro", "Leo Ward", "Mariana Castro", "Owen Price", "Ana Ribeiro", "Caleb Foster",
  "Elena Vargas", "Wyatt Bell", "Larissa Melo", "Ryan Cooper", "Natalia Ortiz", "Dylan Hayes",
];

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-01T15:00:00.000Z");

function slug(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, ".");
}

function seedUsers(): UserRowDto[] {
  return NAMES.map((name, i) => {
    const created = NOW - (i * 1.7 + (i % 5)) * DAY - i * 3_600_000;
    const arcs = 1 + (i % 3 === 0 ? 1 : 0);
    const habits = 3 + (i % 5);
    return {
      uid: `uid${String(i).padStart(3, "0")}${"x".repeat(22)}`.slice(0, 28),
      email: `${slug(name)}@${i % 4 === 0 ? "gmail.com" : i % 4 === 1 ? "outlook.com" : i % 4 === 2 ? "proton.me" : "icloud.com"}`,
      emailVerified: true,
      displayName: name,
      photoURL: null,
      disabled: i === 6 || i === 17,
      createdAt: new Date(created).toISOString(),
      lastSignIn: new Date(NOW - (i % 9) * DAY * 0.6 - i * 600_000).toISOString(),
      providers: ["google.com"],
      admin: i === 0,
      counts: { arcs, habits, checkIns: Math.max(0, habits * (40 - i) - (i % 7) * 3) },
    };
  });
}

const ME: Session = { uid: "uid-me-admin-000000000000000", email: "owner@coldforge.work", displayName: "Forge Owner", photoURL: null };

function seedAudit(users: UserRowDto[]): AuditEntryDto[] {
  const pick = (i: number) => users[i]!;
  const rows: Array<[AuditEntryDto["action"], number, string | null, number, AuditEntryDto["outcome"]]> = [
    ["user.disable", 6, "Spam display names reported by several users", 0.2, "ok"],
    ["admin.grant", 0, "Second admin for on-call coverage", 1.1, "ok"],
    ["user.disable", 17, "Chargeback dispute pending", 2.4, "ok"],
    ["user.enable", 12, "Appeal reviewed, account restored", 3.8, "ok"],
    ["user.delete", 30, "GDPR erasure request #114", 5.0, "ok"],
    ["user.delete", 31, "Duplicate account", 5.1, "error"],
    ["user.disable", 12, "Automated abuse signal", 6.3, "ok"],
  ];
  return rows.map(([action, i, reason, daysAgo, outcome], n) => ({
    id: `audit${String(n).padStart(15, "0")}`,
    actorUid: ME.uid,
    actorEmail: ME.email,
    action,
    targetUid: pick(i).uid,
    targetEmail: pick(i).email,
    reason,
    outcome,
    at: new Date(NOW - daysAgo * DAY).toISOString(),
  }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockBackend(): Backend {
  const params = new URLSearchParams(location.search);
  let users = seedUsers();
  let audit = seedAudit(users);
  let authTime = Date.now();
  let state: AuthState = { status: "signed-out" };
  const listeners = new Set<(s: AuthState) => void>();
  const emit = (s: AuthState) => {
    state = s;
    for (const l of listeners) l(s);
  };
  if (params.get("mock") === "signed-in") state = { status: "ready", session: ME };

  const fail = (code: string, message: string, reason?: CallError["reason"]): never => {
    throw new CallError(code, message, reason);
  };
  const find = (uid: string) => users.find((u) => u.uid === uid) ?? fail("not-found", "User not found.");
  const log = (action: AuditEntryDto["action"], target: UserRowDto, reason: string | null) => {
    audit = [{ id: `audit${Date.now()}`.padEnd(20, "0").slice(0, 20), actorUid: ME.uid, actorEmail: ME.email, action, targetUid: target.uid, targetEmail: target.email, reason, outcome: "ok", at: new Date().toISOString() }, ...audit];
  };
  const recent = () => {
    if (params.get("mock") === "stale" || Date.now() - authTime > 30 * 60_000) {
      fail("failed-precondition", "Please sign in again to confirm this action.", "recent-login-required");
    }
  };

  const handlers: { [K in AdminCallableName]: (data: AdminCallables[K][0]) => AdminCallables[K][1] } = {
    adminStats(): StatsResponse {
      const created = (days: number) => users.filter((u) => u.createdAt && Date.parse(u.createdAt) >= NOW - days * DAY).length;
      const sum = (k: "arcs" | "habits" | "checkIns") => users.reduce((n, u) => n + (u.counts?.[k] ?? 0), 0);
      return {
        totalUsers: users.length,
        usersCapped: false,
        disabledUsers: users.filter((u) => u.disabled).length,
        admins: users.filter((u) => u.admin).length + 1,
        signups7d: created(7),
        signups30d: created(30),
        active7d: Math.round(users.length * 0.62),
        totals: { arcs: sum("arcs"), habits: sum("habits"), checkIns: sum("checkIns") },
        generatedAt: new Date().toISOString(),
      };
    },
    adminListUsers(data): ListUsersResponse {
      const size = data.pageSize ?? 25;
      const q = data.query?.trim().toLowerCase();
      if (q) {
        const hits = users.filter((u) => u.email?.includes(q) || u.displayName?.toLowerCase().includes(q) || u.uid === q);
        return { users: hits, nextPageToken: null, mode: hits.length === 1 && hits[0]?.email === q ? "exact" : "search", scanned: users.length, truncated: false };
      }
      const start = data.pageToken ? Number(data.pageToken.slice(1)) : 0;
      const page = users.slice(start, start + size);
      const end = start + page.length;
      return { users: page, nextPageToken: end < users.length ? `p${end}` : null, mode: "page", scanned: page.length, truncated: false };
    },
    adminGetUser({ uid }): UserDetailResponse {
      const user = find(uid);
      return {
        user,
        profile: { displayName: user.displayName?.split(" ")[0] ?? null, locale: ["es", "en", "pt"][user.uid.charCodeAt(5) % 3] ?? "en", currentArcId: "arc-winter-2026", createdAt: user.createdAt, updatedAt: user.lastSignIn },
        lastRefresh: user.lastSignIn,
      };
    },
    adminSetDisabled({ uid, disabled, reason }) {
      const user = find(uid);
      if (user.admin && disabled) fail("failed-precondition", "Remove admin rights before disabling this account.", "target-is-admin");
      user.disabled = disabled;
      log(disabled ? "user.disable" : "user.enable", user, reason);
      return { ok: true, user: { ...user, counts: null } };
    },
    adminDeleteUser({ uid, confirm, reason }) {
      recent();
      const user = find(uid);
      if (user.admin) fail("failed-precondition", "Remove admin rights before deleting this account.", "target-is-admin");
      if (confirm.trim().toLowerCase() !== (user.email ?? user.uid).toLowerCase()) {
        fail("invalid-argument", "Confirmation does not match the account's email.", "confirm-mismatch");
      }
      users = users.filter((u) => u.uid !== uid);
      log("user.delete", user, reason ?? null);
      return { ok: true, user: null };
    },
    adminSetAdmin({ uid, admin, reason }) {
      recent();
      const user = find(uid);
      if (admin && user.disabled) fail("failed-precondition", "Only enabled accounts with a verified email can be admins.");
      user.admin = admin;
      log(admin ? "admin.grant" : "admin.revoke", user, reason ?? null);
      return { ok: true, user: { ...user, counts: null } };
    },
    adminListAuditLog(data) {
      const size = data.pageSize ?? 50;
      const start = data.pageToken ? audit.findIndex((e) => e.id === data.pageToken) + 1 : 0;
      const entries = audit.slice(start, start + size);
      return { entries, nextPageToken: audit.length > start + size ? (entries.at(-1)?.id ?? null) : null };
    },
  };

  return {
    kind: "mock",
    banner: "MOCK DATA · dev only",
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async signIn() {
      await wait(300);
      if (params.get("mock") === "denied") {
        emit({ status: "signed-out", notice: "denied", email: "someone@gmail.com" });
        return;
      }
      authTime = Date.now();
      emit({ status: "ready", session: ME });
    },
    async signOut(notice) {
      emit({ status: "signed-out", notice });
    },
    async reauthenticate() {
      await wait(300);
      authTime = Date.now();
      params.delete("mock");
    },
    async call(name, data) {
      await wait(name === "adminStats" ? 450 : 250);
      return structuredClone((handlers[name] as (d: unknown) => unknown)(data)) as never;
    },
  };
}
