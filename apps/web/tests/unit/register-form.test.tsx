import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterForm } from "@/components/RegisterForm";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });
/** The error Field renders under an input, linked to it by aria-describedby. */
const errorNextTo = (label: string) => document.getElementById(input(label).getAttribute("aria-describedby") ?? "")?.textContent;
const sentBody = (fetchMock: ReturnType<typeof mockServer>) => JSON.parse(fetchMock.mock.calls[0][1].body);

function fillIn(confirmPassword = "Passw0rd!") {
  type("Full name", "Jamie Lee");
  type("Work email", "jamie@example.com");
  type("Password", "Passw0rd!");
  type("Confirm password", confirmPassword);
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Create account" }));

describe("SCRUM-12 Account Registration form", () => {
  it("SCRUM-12/AC1: has a confirm password field that is sent, and shows its error (AC7) next to it", async () => {
    const fetchMock = mockServer(400, {
      error: "Please fix the highlighted fields.",
      fieldErrors: { confirmPassword: "Passwords do not match." },
    });
    render(<RegisterForm />);

    fillIn("Different1!");
    submit();

    await waitFor(() => expect(errorNextTo("Confirm password")).toBe("Passwords do not match."));
    expect(sentBody(fetchMock)).toMatchObject({ password: "Passw0rd!", confirmPassword: "Different1!" });
  });

  it("SCRUM-12/AC8: after a failed submit, keeps the name and email and clears both password fields", async () => {
    mockServer(409, {
      error: "An account with this email already exists.",
      fieldErrors: { email: "An account with this email already exists." },
    });
    render(<RegisterForm />);

    fillIn();
    submit();

    await waitFor(() => expect(errorNextTo("Work email")).toBe("An account with this email already exists."));
    expect(input("Full name").value).toBe("Jamie Lee");
    expect(input("Work email").value).toBe("jamie@example.com");
    expect(input("Password").value).toBe("");
    expect(input("Confirm password").value).toBe("");
  });

  it("SCRUM-12/AC10: offers no role choice and sends no role", async () => {
    const fetchMock = mockServer(201, { message: "Registration successful. You can now sign in." });
    render(<RegisterForm />);

    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    fillIn();
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock)).not.toHaveProperty("role");
  });

  it("SCRUM-12/AC9: on success, shows the success message and directs the user to the login page", async () => {
    mockServer(201, { message: "Registration successful. You can now sign in." });
    render(<RegisterForm />);

    fillIn();
    submit();

    expect((await screen.findByRole("status")).textContent).toBe("Registration successful. You can now sign in.");
    expect(screen.getByRole("link", { name: "Go to sign in" }).getAttribute("href")).toBe("/login");
  });

  it("SCRUM-12/AC12: a double-click while the request is in flight sends only one request", async () => {
    let reply!: (response: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((resolve) => { reply = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RegisterForm />);
    const button = screen.getByRole("button", { name: "Create account" });

    fillIn();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    reply({ ok: true, status: 201, json: async () => ({ message: "Registration successful. You can now sign in." }) });
    await screen.findByRole("status");
  });

  it("SCRUM-12/AC13: shows the error message when account creation fails because of a system error", async () => {
    mockServer(500, { error: "We couldn't create your account. Please try again." });
    render(<RegisterForm />);

    fillIn();
    submit();

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't create your account. Please try again.");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
