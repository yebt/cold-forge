/**
 * Outgoing email. `Mailer` is an interface so tests inject a fake and production uses SMTP.
 *
 * The only user-controlled value that reaches a header is the recipient, which has already been
 * validated by `normalizeEmail` (no whitespace, commas, angle brackets or control characters).
 */
import { getMessages, type Locale } from "@cold-forge/i18n";
import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config.ts";
import { maskEmail } from "./crypto.ts";
import { apiMessages } from "./i18n/index.ts";

export interface LoginEmail {
  to: string;
  locale: Locale;
  code: string;
  link: string;
  expiresInMinutes: number;
}

export interface Mailer {
  sendLoginEmail(message: LoginEmail): Promise<void>;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export function renderLoginEmail({ locale, code, link, expiresInMinutes }: LoginEmail): RenderedEmail {
  const t = apiMessages(locale).loginEmail;
  const app = getMessages(locale).appName;
  const e = escapeHtml;
  const subject = t.subject(app);
  const text = [
    t.intro(app),
    "",
    `    ${code}`,
    "",
    t.linkIntro,
    link,
    "",
    t.expires(expiresInMinutes),
    t.neverShare,
    t.ignore,
  ].join("\n");
  const html = `<!doctype html>
<html lang="${e(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(subject)}</title></head>
<body style="margin:0;padding:24px;background:#0b1220;color:#e6edf6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto">
<p style="font-size:13px;letter-spacing:.2em;font-weight:700;color:#8fb8ff">${e(app)}</p>
<p style="font-size:16px;line-height:1.5">${e(t.intro(app))}</p>
<p style="font-size:34px;font-weight:700;letter-spacing:.3em;font-family:Menlo,Consolas,monospace;margin:24px 0">${e(code)}</p>
<p style="font-size:14px;line-height:1.5">${e(t.linkIntro)}</p>
<p><a href="${e(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#8fb8ff;color:#0b1220;font-weight:700;text-decoration:none">${e(t.button)}</a></p>
<p style="font-size:13px;line-height:1.5;color:#9aa7b8">${e(t.expires(expiresInMinutes))}<br>${e(t.neverShare)}<br>${e(t.ignore)}</p>
</div></body></html>`;
  return { subject, text, html };
}

/** Only what we need from a nodemailer transport (injectable so tests can inspect the envelope). */
export interface MailTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown>;
}

export function createSmtpMailer(smtp: SmtpConfig, transport: MailTransport = createSmtpTransport(smtp)): Mailer {
  return {
    async sendLoginEmail(message) {
      const { subject, text, html } = renderLoginEmail(message);
      // `to` is the canonical ASCII address from normalizeEmail: the envelope recipient is exactly it.
      await transport.sendMail({ from: smtp.from, to: message.to, subject, text, html });
    },
  };
}

export function createSmtpTransport(smtp: SmtpConfig): MailTransport {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // When not using implicit TLS, refuse to send over a connection that cannot upgrade with STARTTLS.
    requireTLS: smtp.requireTls,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/**
 * The only part of a mail error that is safe to log: nodemailer's error code and the SMTP reply
 * code. Never the error object or message (they can echo the recipient or server replies).
 */
export function mailErrorSummary(e: unknown): string {
  const err = (e ?? {}) as { code?: unknown; responseCode?: unknown };
  const code = typeof err.code === "string" && /^[A-Z_]{1,32}$/.test(err.code) ? err.code : "unknown";
  const response = typeof err.responseCode === "number" ? String(err.responseCode) : "-";
  return `code=${code} responseCode=${response}`;
}

/**
 * DEVELOPMENT ONLY: prints the code and link to the console instead of emailing them.
 * Refuses to exist outside development so a misconfiguration can never log live credentials
 * (config additionally requires DEV_CONSOLE_MAILER=1 and a loopback HOST).
 */
export function createDevConsoleMailer(env: string, log: (line: string) => void = console.log): Mailer {
  if (env !== "development") throw new Error("The console mailer is only available in development");
  return {
    async sendLoginEmail({ to, code, link, locale }) {
      log(
        [
          "",
          "==================== [DEV ONLY] login email (not sent) ====================",
          `  to:     ${maskEmail(to)} (locale ${locale})`,
          `  code:   ${code}`,
          `  link:   ${link}`,
          "==========================================================================",
          "",
        ].join("\n"),
      );
    },
  };
}
