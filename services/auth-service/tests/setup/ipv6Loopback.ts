// SCRUM-195/AC8: test requests go to [::1], so no other program can answer them (scripts/vitest/ipv6Loopback.ts).
// Loaded before every test file by this workspace's vitest.config.ts (setupFiles); supertest is imported here, from this
// workspace, so the change reaches the same copy the tests use.
import supertest from "supertest";
import { prepare, sendSupertestToIpv6Loopback } from "../../../../scripts/vitest/ipv6Loopback";

if (await prepare()) sendSupertestToIpv6Loopback(supertest.Test);
