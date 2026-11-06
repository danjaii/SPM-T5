import type { Role } from "@spm-t5/shared";
import { PRIMARY_BY_ROLE, homePath } from "../../fixtures/accounts";
import { WEB_URL } from "../../fixtures/env";
import { expect, test } from "../../fixtures/test";
import { tc } from "../../fixtures/tc";

// Who may open each guarded page, written out here on purpose and not imported from apps/web/src/lib/roleAccess.ts:
// a test that asked the app's own rule would pass whatever the rule said. Source of the table: SCRUM-122/AC3, the
// Lead pages (SCRUM-77/AC7) and SCRUM-84/AC8 (docs/specs/event-coordinator-lead-role.md, SCRUM-84-venue-availability-calendar.md).
const OWNERS: Record<string, Role[]> = {
  "/lead/queue": ["event_coordinator_lead"],
  "/booking-queue": ["venue_staff"],
  "/safety-checks": ["safety_officer"],
  "/equipment-requests": ["technical_support_staff"],
  "/equipment-availability": ["technical_support_staff"],
  "/equipment-inventory": ["technical_support_staff"],
  "/equipment-catalogue": ["technical_support_staff"],
  "/equipment-reservation": ["technical_support_staff"],
  "/my-event-requests": ["event_organiser"],
  "/venue-calendar": ["event_coordinator", "venue_staff", "technical_support_staff"],
};

const ROLES = Object.keys(PRIMARY_BY_ROLE) as Role[];
const t = tc("E2E-ACL-01");

test.describe.configure({ timeout: 420_000 }); // 7 roles, each with 3 real page loads; `next dev` compiles a page on its first visit

test(t.title, { annotation: t.annotation }, async ({ as }) => {
  for (const role of ROLES) {
    await test.step(`${role}: other roles' pages are refused, own pages open`, async () => {
      const page = await as(PRIMARY_BY_ROLE[role]);

      const refused = [
        ...Object.entries(OWNERS).filter(([, owners]) => !owners.includes(role)).map(([path]) => path),
        ...ROLES.filter((other) => other !== role).map((other) => `/dashboard/${other}`),
      ];
      // Every refused URL: the guard answers with a redirect to the access-denied page. Asked with the role's own session and
      // without following the redirect, which is the same decision a browser would get, minus loading a full page each time
      // (`next dev` takes seconds per page, and 7 roles x 15 pages ran past the test timeout).
      for (const path of refused) {
        const res = await page.request.get(new URL(path, WEB_URL).href, { maxRedirects: 0 });
        expect(res.status(), `${role} requesting ${path}`).toBeGreaterThanOrEqual(300);
        expect(res.status(), `${role} requesting ${path}`).toBeLessThan(400);
        expect(res.headers()["location"] ?? "", `${role} requesting ${path}`).toMatch(/\/access-denied/);
      }
      // ...and what the person actually sees, once per role in a real browser navigation
      await page.goto(refused[0]);
      await expect(page, `${role} opening ${refused[0]}`).toHaveURL(/\/access-denied/);
      await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();

      // positive controls: a guard that refused everyone would also pass the loop above
      await page.goto(`/dashboard/${role}`);
      await expect(page, `${role} opening its own dashboard`).toHaveURL(new RegExp(`${homePath(role)}$`));
      const own = Object.entries(OWNERS).find(([, owners]) => owners.includes(role))?.[0];
      if (own) {
        await page.goto(own);
        await expect(page, `${role} opening ${own}`).not.toHaveURL(/\/access-denied|\/login/);
      }
    });
  }
});
