import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

// SCRUM-122: register, forgot-password and reset-password use the same building blocks as sign in
describe("SCRUM-122/AC10 forgot-password and reset-password states", () => {
  it("SCRUM-122/AC10 shows the success message with a status role after a reset link is sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: "Check your email." }) }));
    render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Check your email."));
  });

  it("SCRUM-122/AC10 shows the email error under the field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ fieldErrors: { email: "Enter a valid email." } }) }));
    render(<ForgotPasswordForm />);

    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("Enter a valid email.")).toBeTruthy();
    expect(screen.getByLabelText("Work email").getAttribute("aria-invalid")).toBe("true");
  });

  it("SCRUM-122/AC10 explains an invalid reset link with an alert", async () => {
    window.location.hash = "";
    render(<ResetPasswordForm />);

    expect((await screen.findByRole("alert")).textContent).toContain("invalid or has expired");
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/login");
  });
});
