import { computeArcStats, isISODate, localToday } from "@cold-forge/core";
import { buildShareText, detectLocale, getMessages, isLocale } from "@cold-forge/i18n";
import type { Store } from "./store.ts";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const badRequest = (error: string) => json({ error }, 400);

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function todayFrom(req: Request): string | null {
  const today = new URL(req.url).searchParams.get("today") ?? localToday();
  return isISODate(today) ? today : null;
}

/** Route table for Bun.serve. The client passes `?today=YYYY-MM-DD` so stats follow the user's timezone. */
export function createRoutes(store: Store, now: () => Date = () => new Date()) {
  const arc = () => store.getOrCreateArc(now().getFullYear());

  return {
    "/api/health": () => json({ ok: true }),

    "/api/arc": {
      GET: () => json(arc()),
      PATCH: async (req: Request) => {
        const body = await readBody(req);
        const { title, startDate, endDate } = body;
        if (title !== undefined && (typeof title !== "string" || !title.trim())) return badRequest("invalid title");
        if (startDate !== undefined && !isISODate(startDate)) return badRequest("invalid startDate");
        if (endDate !== undefined && !isISODate(endDate)) return badRequest("invalid endDate");
        const current = arc();
        if ((startDate ?? current.startDate) > (endDate ?? current.endDate)) {
          return badRequest("startDate must be before endDate");
        }
        store.updateArc(current.id, { title: title?.trim(), startDate, endDate });
        return json(arc());
      },
    },

    "/api/habits": {
      POST: async (req: Request) => {
        const { name, emoji } = await readBody(req);
        if (typeof name !== "string" || !name.trim()) return badRequest("name is required");
        const icon = typeof emoji === "string" && emoji.trim() ? emoji.trim() : "🔥";
        return json(store.addHabit(arc().id, name.trim().slice(0, 60), icon.slice(0, 8)), 201);
      },
    },

    "/api/habits/:id": {
      DELETE: (req: Request & { params: { id: string } }) =>
        store.deleteHabit(arc().id, req.params.id) ? new Response(null, { status: 204 }) : json({ error: "not found" }, 404),
    },

    "/api/check-ins/toggle": {
      POST: async (req: Request) => {
        const { habitId, date } = await readBody(req);
        if (!isISODate(date)) return badRequest("date must be YYYY-MM-DD");
        const current = arc();
        if (!current.habits.some((h) => h.id === habitId)) return json({ error: "habit not found" }, 404);
        if (date < current.startDate || date > current.endDate) return badRequest("date is outside the arc");
        return json({ habitId, date, done: store.toggleCheckIn(habitId as string, date) });
      },
    },

    "/api/check-ins": () => json(store.listCheckIns(arc().id)),

    "/api/stats": (req: Request) => {
      const today = todayFrom(req);
      if (!today) return badRequest("today must be YYYY-MM-DD");
      const current = arc();
      return json(computeArcStats(current, store.listCheckIns(current.id), today));
    },

    "/api/share": (req: Request) => {
      const today = todayFrom(req);
      if (!today) return badRequest("today must be YYYY-MM-DD");
      const current = arc();
      const stats = computeArcStats(current, store.listCheckIns(current.id), today);
      const param = new URL(req.url).searchParams.get("locale");
      const locale = isLocale(param) ? param : detectLocale(req.headers.get("accept-language"));
      return json({ locale, text: buildShareText(stats, getMessages(locale)), stats });
    },
  };
}
