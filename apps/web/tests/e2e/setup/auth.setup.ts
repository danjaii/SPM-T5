import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test as setup, expect } from "@playwright/test";
import { ACCOUNTS, PERSONAS, storageStatePath } from "../fixtures/accounts";
import { PASSWORD, SERVICE_URL } from "../fixtures/env";

// Signs every persona in once, through auth-service (the same call the login form makes), and saves the session cookie as
// a storageState file. Tests then open a page "as" a persona without signing in again: that keeps a full run well under
// the sign-in rate limit (300 per 5 minutes in supabase/config.toml). The sign-in form itself is covered by E2E-AUTH-01.

for (const who of PERSONAS) {
  setup(`sign in as ${who}`, async () => {
    const { email, role } = ACCOUNTS[who];
    const res = await fetch(`${SERVICE_URL.auth}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, role }),
    });
    expect(res.status, `login as ${who} (${email}) answered ${res.status}: is the seeded database loaded?`).toBe(200);

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("cs_session="));
    expect(cookie, "the login reply sets no cs_session cookie").toBeTruthy();
    const value = cookie!.split(";")[0].slice("cs_session=".length);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie!)?.[1] ?? 3600);

    const file = storageStatePath(who);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        cookies: [
          {
            name: "cs_session",
            value,
            domain: "localhost",
            path: "/",
            expires: Math.floor(Date.now() / 1000) + maxAge - 60,
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      }),
    );
  });
}
