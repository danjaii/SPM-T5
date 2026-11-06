import { describe, expect, it } from "vitest";
import { loopbackUrl, serverBaseUrl } from "../../../../scripts/vitest/ipv6Loopback";

// SCRUM-195/AC8: when scripts/vitest/ipv6Loopback.ts moves a request to [::1], and when it leaves it alone.
describe("SCRUM-195/AC8 which address a test request is sent to", () => {
  it("sends a request for a server on [::] to [::1] when [::1] works, keeping the port and path", () => {
    expect(loopbackUrl("http://127.0.0.1:51920/events/1?x=1", "::", true)).toBe("http://[::1]:51920/events/1?x=1");
    expect(loopbackUrl("https://127.0.0.1:443/", "::", true)).toBe("https://[::1]:443/");
  });

  it("changes nothing where [::1] does not work (IPv6 turned off, as on some Windows machines and containers)", () => {
    expect(loopbackUrl("http://127.0.0.1:51920/", "::", false)).toBe("http://127.0.0.1:51920/");
  });

  it("changes nothing for a server that is not on [::]: Node fell back to IPv4, or the test named its own address", () => {
    expect(loopbackUrl("http://127.0.0.1:51920/", "0.0.0.0", true)).toBe("http://127.0.0.1:51920/");
    expect(loopbackUrl("http://127.0.0.1:51920/", "127.0.0.1", true)).toBe("http://127.0.0.1:51920/");
    expect(loopbackUrl("http://127.0.0.1:51920/", undefined, true)).toBe("http://127.0.0.1:51920/");
  });

  it("gives a test that starts its own server the same choice of address", () => {
    expect(serverBaseUrl({ address: "::", family: "IPv6", port: 4005 }, true)).toBe("http://[::1]:4005");
    expect(serverBaseUrl({ address: "::", family: "IPv6", port: 4005 }, false)).toBe("http://127.0.0.1:4005");
    expect(serverBaseUrl({ address: "0.0.0.0", family: "IPv4", port: 4005 }, true)).toBe("http://127.0.0.1:4005");
  });
});
