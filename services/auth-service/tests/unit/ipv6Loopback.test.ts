import { createServer } from "node:http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { ipv6LoopbackWorks } from "../../../../scripts/vitest/ipv6Loopback";

// SCRUM-195/AC8: tests/setup/ipv6Loopback.ts, loaded by this workspace's vitest.config.ts.
describe("SCRUM-195/AC8 supertest requests go to [::1], so no other program on the same port number can answer them", () => {
  it("a request made with supertest reaches the test's own server over [::1] (or 127.0.0.1 where [::1] does not work)", async () => {
    const app = createServer((req, res) => res.end(req.socket.localAddress));

    const res = await request(app).get("/");

    if (await ipv6LoopbackWorks()) expect(res.text).toBe("::1");
    else expect(res.text).not.toBe("::1");
  });
});
