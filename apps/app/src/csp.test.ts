import { describe, expect, test } from "bun:test";
import { cspDirectives } from "../vite.config.ts";

/** L3: the app's CSP names exact hosts; App Check / reCAPTCHA hosts only when it is enabled. */
const AUTH = "https://coldforge-work.firebaseapp.com";
const directive = (list: string[], name: string) => list.find((d) => d.startsWith(`${name} `)) ?? "";

describe("Content-Security-Policy", () => {
  test("production, App Check off: exact Firebase hosts, no wildcards, no reCAPTCHA", () => {
    const csp = cspDirectives({ dev: false, authOrigin: AUTH, appCheck: false });
    expect(directive(csp, "connect-src")).toBe(
      `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com ${AUTH}`,
    );
    expect(directive(csp, "script-src")).toBe("script-src 'self' https://apis.google.com");
    expect(directive(csp, "frame-src")).toBe(`frame-src ${AUTH} https://apis.google.com`);
    const all = csp.join("; ");
    expect(all).not.toContain("*.googleapis.com");
    expect(all).not.toContain("recaptcha");
    expect(all).not.toContain("cloudfunctions.net");
    expect(all).not.toContain("unsafe-inline");
    expect(all).not.toContain("127.0.0.1");
  });

  test("App Check on: adds exactly the reCAPTCHA / App Check hosts", () => {
    const csp = cspDirectives({ dev: false, authOrigin: AUTH, appCheck: true });
    expect(directive(csp, "connect-src")).toContain("https://content-firebaseappcheck.googleapis.com");
    expect(directive(csp, "connect-src")).toContain("https://recaptchaenterprise.googleapis.com");
    expect(directive(csp, "script-src")).toBe("script-src 'self' https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/");
    expect(directive(csp, "frame-src")).toContain("https://www.google.com/recaptcha/");
  });
});
