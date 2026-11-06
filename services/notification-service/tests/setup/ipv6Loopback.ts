// SCRUM-195/AC8: test requests go to [::1], so no other program can answer them (scripts/vitest/ipv6Loopback.ts).
// Loaded before every test file by this workspace's vitest.config.ts (setupFiles). This workspace's tests start their own
// servers and build the URL with serverBaseUrl(), which uses [::1] once prepare() has found that it works.
import { prepare } from "../../../../scripts/vitest/ipv6Loopback";

await prepare();
