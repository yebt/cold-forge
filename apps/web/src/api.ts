import { localToday, type Arc, type ArcStats, type CheckIn, type Habit } from "@cold-forge/core";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Error ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const today = () => localToday();

export const api = {
  arc: () => request<Arc>("/api/arc"),
  stats: () => request<ArcStats>(`/api/stats?today=${today()}`),
  checkIns: () => request<CheckIn[]>("/api/check-ins"),
  share: () => request<{ text: string }>(`/api/share?today=${today()}`),
  addHabit: (name: string, emoji: string) =>
    request<Habit>("/api/habits", { method: "POST", body: JSON.stringify({ name, emoji }) }),
  deleteHabit: (id: string) => request<void>(`/api/habits/${id}`, { method: "DELETE" }),
  toggle: (habitId: string, date = today()) =>
    request<{ done: boolean }>("/api/check-ins/toggle", { method: "POST", body: JSON.stringify({ habitId, date }) }),
};
