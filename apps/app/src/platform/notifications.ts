import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { ALL_REMINDER_IDS, type PlannedReminder } from "../lib/reminders.ts";

export type ReminderPermission = "granted" | "denied" | "unsupported";

/** Scheduled local notifications only make sense in the native app; web is a graceful no-op. */
export function remindersSupported(): boolean {
  return Capacitor.isNativePlatform();
}

export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported()) return "unsupported";
  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== "granted") status = await LocalNotifications.requestPermissions();
    return status.display === "granted" ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

/** Replaces every pending reminder with `planned` (an empty list just cancels). */
export async function syncReminders(planned: PlannedReminder[]): Promise<void> {
  if (!remindersSupported()) return;
  try {
    await LocalNotifications.cancel({ notifications: ALL_REMINDER_IDS.map((id) => ({ id })) });
    if (planned.length === 0) return;
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: planned.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        schedule: { at: r.at, allowWhileIdle: true },
      })),
    });
  } catch (e) {
    console.warn("[reminders]", e);
  }
}
