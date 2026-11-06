// SCRUM-195/AC8: test requests go to the IPv6 loopback, [::1], so no other program can answer them.
//
// A test server started with listen(0) (supertest does this for every request) binds [::], the dual-stack wildcard, on
// a random port, and the request is then sent to 127.0.0.1 on that port. macOS lets another program hold 127.0.0.1 on
// the same port number at the same time (VS Code and its Playwright extension keep several such servers open), and the
// request then reaches that program instead of the test's app: a 404, an empty body or a hang. In a full run of
// thousands of supertest servers, about one a run landed on such a port. Nothing listens on [::1] the same way, and the
// [::] socket accepts [::1] connections, so sending the requests there removes the clash without changing how servers
// start. Binding 127.0.0.1 instead does not work: supertest reads the address straight after listen(), and Node only
// has it then when no host is given.
//
// Before anything changes, one real connection to [::1] is tried (prepare). Where that fails (IPv6 turned off, as on
// some Windows machines and containers) nothing is changed and requests keep going to 127.0.0.1 as before.
import { connect, createServer, type AddressInfo } from "node:net";

let ipv6 = false;

/** Whether a server bound the way listen(0) binds it accepts a connection on [::1] on this machine. */
export async function ipv6LoopbackWorks(timeoutMs = 2000): Promise<boolean> {
  const server = createServer((socket) => socket.end());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, resolve);
    });
    const { address, port } = server.address() as AddressInfo;
    if (address !== "::") return false; // Node fell back to IPv4 (0.0.0.0): there is no [::] socket to reach
    return await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "::1", port });
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  } catch {
    return false;
  } finally {
    server.close();
  }
}

/** Checks [::1] once, for the helpers below. Run from each service's test setup file. */
export async function prepare(): Promise<boolean> {
  ipv6 = await ipv6LoopbackWorks();
  return ipv6;
}

/** The URL supertest should use for a server: [::1] when the server is on [::] and [::1] works, else unchanged. */
export function loopbackUrl(url: string, serverAddress: string | undefined, useIpv6 = ipv6): string {
  return useIpv6 && serverAddress === "::" ? url.replace(/^(https?):\/\/127\.0\.0\.1:/, "$1://[::1]:") : url;
}

/** The base URL for a test server a test started itself (`http://<host>:<port>`), chosen the same way. */
export function serverBaseUrl(address: AddressInfo, useIpv6 = ipv6): string {
  return loopbackUrl(`http://127.0.0.1:${address.port}`, address.address, useIpv6);
}

type SupertestTest = { prototype: { serverAddress(app: { address(): AddressInfo | string | null }, path: string): string } };

/** Sends every supertest request for a server on [::] to [::1] instead of 127.0.0.1 (when [::1] works). */
export function sendSupertestToIpv6Loopback(Test: SupertestTest): void {
  const original = Test.prototype.serverAddress;
  // supertest is loaded once per worker but this runs before every test file: change it only the first time
  if (original.name === "serverAddressOnIpv6Loopback") return;
  Test.prototype.serverAddress = function serverAddressOnIpv6Loopback(app, path) {
    const url = original.call(this, app, path);
    const address = app.address();
    return loopbackUrl(url, typeof address === "object" && address ? address.address : undefined);
  };
}
