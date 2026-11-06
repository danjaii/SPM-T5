import { rm } from "node:fs/promises";
import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { type Persona, storageStatePath } from "./accounts";
import { TestData } from "./data";

interface Fixtures {
  /**
   * Opens a page signed in as a persona, in a browser context of its own. A test that spans roles calls it once per role,
   * so each person has separate cookies. The sessions come from the auth setup project (tests/e2e/setup/auth.setup.ts).
   */
  as: (who: Persona) => Promise<Page>;
  /** Arranges and cleans up this test's data (see data.ts). Named after the catalogue ID in the test title. */
  data: TestData;
}

export const test = base.extend<Fixtures>({
  as: async ({ browser }, provide, testInfo) => {
    // Trace and screenshots follow the config for contexts opened here, but video does not, so it is recorded explicitly and
    // kept only for a failed test (the config's "retain-on-failure").
    const mode = testInfo.project.use.video;
    const recordVideo = (typeof mode === "string" ? mode : mode?.mode) !== "off" && mode !== undefined;
    const videoDir = testInfo.outputPath("videos");
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    await provide(async (who) => {
      const context = await browser.newContext({
        storageState: storageStatePath(who),
        ...(recordVideo ? { recordVideo: { dir: videoDir } } : {}),
      });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      return page;
    });
    await Promise.all(contexts.map((c) => c.close())); // a video is only complete once its context is closed
    if (!recordVideo) return;
    if (testInfo.status === testInfo.expectedStatus) {
      await rm(videoDir, { recursive: true, force: true });
      return;
    }
    for (const [i, page] of pages.entries()) {
      const video = page.video();
      if (video) await testInfo.attach(`video-${i + 1}`, { path: await video.path(), contentType: "video/webm" });
    }
  },

  data: async ({}, provide, testInfo) => {
    const caseId = /^(E2E-[A-Z]+-\d+)/.exec(testInfo.title)?.[1] ?? "E2E";
    const data = new TestData(caseId);
    await provide(data);
    await data.cleanup();
  },
});

export { expect } from "@playwright/test";
