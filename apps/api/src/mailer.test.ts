import { describe, expect, test } from "bun:test";
import { createDevConsoleMailer, escapeHtml, renderLoginEmail } from "./mailer.ts";

const base = { to: "a@b.co", code: "012345", link: "https://app.example.com/#/auth?token=abc", expiresInMinutes: 15 };

describe("mailer", () => {
  test("renders code and link in text and html, localized", () => {
    const en = renderLoginEmail({ ...base, locale: "en" });
    const es = renderLoginEmail({ ...base, locale: "es" });
    const pt = renderLoginEmail({ ...base, locale: "pt" });
    for (const m of [en, es, pt]) {
      expect(m.text).toContain("012345");
      expect(m.text).toContain(base.link);
      expect(m.html).toContain("012345");
      expect(m.subject).not.toContain("012345"); // the code stays out of notification previews
      expect(m.subject).not.toMatch(/[\r\n]/);
    }
    expect(new Set([en.subject, es.subject, pt.subject]).size).toBe(3);
    expect(es.text).toContain("minutos");
  });

  test("html-escapes interpolated values", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    const m = renderLoginEmail({ ...base, locale: "en", link: 'https://x/"><script>alert(1)</script>' });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });

  test("dev console mailer prints the code but never exists in production", async () => {
    expect(() => createDevConsoleMailer("production")).toThrow();
    const lines: string[] = [];
    await createDevConsoleMailer("development", (l) => lines.push(l)).sendLoginEmail({ ...base, locale: "en" });
    expect(lines.join()).toContain("[DEV ONLY]");
    expect(lines.join()).toContain("012345");
    expect(lines.join()).not.toContain("a@b.co"); // masked
  });
});
