// this test file checks the password reset journey in the browser: from the sign-in page to a new password

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import LoginPage from "@/app/(auth)/login/page";
import { LoginForm } from "@/components/LoginForm";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
  replace.mockClear();
});

/** Opens the reset form the way the email link does: Supabase puts the recovery token in the URL hash. */
function openResetLink() {
  window.location.hash = "#access_token=recovery-token&type=recovery";
  render(<ResetPasswordForm />);
}

/** auth-service answers the new password with this status and body. */
function mockResetReply(ok: boolean, body: object) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, json: async () => body }));
}

// ---------------------------------------------------------------------------
// SCRUM-14 — Password reset
// ---------------------------------------------------------------------------
describe("SCRUM-14 password reset", () => {
  it("SCRUM-14/AC1 offers a reset password link on the sign-in page", () => {
    render(<LoginForm />);

    expect(screen.getByRole("link", { name: /forgot password/i }).getAttribute("href")).toBe("/forgot-password");
  });

  it("SCRUM-14/AC5 shows which complexity rule the new password breaks, next to the field", async () => {
    mockResetReply(false, { error: "Please fix the highlighted fields.", fieldErrors: { password: "Password must include a symbol." } });
    openResetLink();

    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "N3wPassw0rd" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password must include a symbol.")).toBeTruthy();
    expect(screen.getByLabelText("New password").getAttribute("aria-invalid")).toBe("true");
  });

  it("SCRUM-14/AC7 takes the user to the sign-in page once the new password is saved", async () => {
    mockResetReply(true, { message: "Password updated. You can now sign in." });
    openResetLink();

    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "N3wPassw0rd!" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reset=success"));
  });

  it("SCRUM-14/AC6 confirms the password change on the sign-in page the user lands on", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({ reset: "success" }) }));

    expect(screen.getByRole("status").textContent).toContain("Password updated. You can now sign in.");
  });

  it("SCRUM-14/AC6 shows no password message on an ordinary visit to the sign-in page", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("status")).toBeNull();
  });
});
