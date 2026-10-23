// this test file checks the Log out button in the app shell and where it takes the user

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "@spm-t5/shared";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { LogoutButton } from "@/components/LogoutButton";
import { ShellFrame } from "@/components/shell/ShellFrame";

/** auth-service accepts the logout; the browser's location.replace is watched instead of navigating. */
function mockLogout() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  const replace = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { ...window.location, replace });
  return { fetchMock, replace };
}

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// SCRUM-17 — Logout of ConnectSphere
// ---------------------------------------------------------------------------
describe("SCRUM-17 — Logout button", () => {
  // AC1: the logout button is displayed on every signed-in page, whatever the role
  it.each(ROLES)("SCRUM-17/AC1 shows Log out in the %s's sidebar", (role) => {
    render(<ShellFrame shell={{ user: { fullName: "Priya Nair", role }, counts: {} }}><p>page body</p></ShellFrame>);

    expect(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("button", { name: "Log out" })).toBeTruthy();
  });
  // end of AC1

  // AC2: selecting Log out asks auth-service to end the session, sending the session cookie with it
  it("SCRUM-17/AC2 asks auth-service to end the session", async () => {
    const { fetchMock } = mockLogout();
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/auth\/logout$/);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
  });
  // end of AC2

  // AC3: once the session has ended, the user is taken to the login page
  it("SCRUM-17/AC3 takes the user to the login page after logging out", async () => {
    const { fetchMock, replace } = mockLogout();
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    // only after auth-service was asked, so the session is already gone when the login page opens
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0]);
  });
  // end of AC3

  // AC4: the login page replaces the signed-in page in the browser history, so Back has no signed-in page to return to
  it("SCRUM-17/AC4 replaces the signed-in page in the history rather than adding the login page after it", async () => {
    const { replace } = mockLogout();
    // the two ways of navigating that add a history entry instead
    const assign = vi.fn();
    const setHref = vi.fn();
    vi.stubGlobal("location", { replace, assign, set href(url: string) { setHref(url); } });
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(assign).not.toHaveBeenCalled();
    expect(setHref).not.toHaveBeenCalled();
  });
  // end of AC4
});
// end of SCRUM-17
