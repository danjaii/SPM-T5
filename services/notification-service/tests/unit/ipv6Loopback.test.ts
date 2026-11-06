import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ipv6LoopbackWorks, serverBaseUrl } from "../../../../scripts/vitest/ipv6Loopback";

// SCRUM-195/AC8: this workspace's tests start their own servers and reach them through serverBaseUrl().
describe("SCRUM-195/AC8 test requests go to [::1], so no other program on the same port number can answer them", () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  });

  it("a test server's base URL reaches it over [::1] (or 127.0.0.1 where [::1] does not work)", async () => {
    server = createServer((req, res) => res.end(req.socket.localAddress));
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const reply = await (await fetch(serverBaseUrl(server.address() as AddressInfo))).text();

    if (await ipv6LoopbackWorks()) expect(reply).toBe("::1");
    else expect(reply).not.toBe("::1");
  });
});
