import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh, toastSuccess } = vi.hoisted(() => ({ refresh: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), redirect: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

import { RegistrationSettingsForm } from "@/components/RegistrationSettingsForm";
import { fromLocalInput, saveRegistrationSettings, toLocalInput, type RegistrationSettingsView } from "@/lib/registrationSettings";

// SCRUM-185/AC4 (docs/specs/registration-settings-while-replanning.md): the coordinator's Registration settings form.
const settings = (over: Partial<RegistrationSettingsView> = {}): RegistrationSettingsView => ({
  status: "planning",
  registrationRequired: true,
  capacity: 100,
  opensAt: "2031-10-01T01:00:00.000Z", // 09:00 Singapore time
  closesAt: "2031-11-13T01:00:00.000Z",
  eventStart: "2031-11-14T01:00:00.000Z",
  confirmedCount: 5,
  closedByStatus: true,
  ...over,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
  toastSuccess.mockClear();
});

describe("SCRUM-185/AC4 185-S4g the time helpers", () => {
  it("185-S4g: an instant is shown as a Singapore datetime-local value, and back", () => {
    expect(toLocalInput("2031-10-01T01:00:00.000Z")).toBe("2031-10-01T09:00");
    expect(fromLocalInput("2031-10-01T09:00")).toBe("2031-10-01T01:00:00.000Z");
  });

  it("185-S4g: nothing and nonsense are empty, not a wrong time", () => {
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("not a date")).toBe("");
    expect(fromLocalInput("")).toBeUndefined();
    expect(fromLocalInput("2031-10-01")).toBeUndefined();
    expect(fromLocalInput("2031-13-45T99:99")).toBeUndefined();
  });
});

describe("SCRUM-185/AC4 185-S4g the form shows the current settings", () => {
  it("185-S4g: capacity and both times, in Singapore time, with how many are confirmed", () => {
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    expect((screen.getByLabelText("Capacity") as HTMLInputElement).value).toBe("100");
    expect((screen.getByLabelText("Registration opens") as HTMLInputElement).value).toBe("2031-10-01T09:00");
    expect((screen.getByLabelText("Registration closes") as HTMLInputElement).value).toBe("2031-11-13T09:00");
    expect(screen.getByText(/5 attendees are confirmed/)).toBeTruthy();
    expect(screen.getByText("All times are Singapore time.")).toBeTruthy();
  });

  it("185-S4g: one confirmed attendee reads in the singular", () => {
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings({ confirmedCount: 1 })} />);
    expect(screen.getByText(/1 attendee is confirmed/)).toBeTruthy();
  });

  it("185-S4g: while the event is not Confirmed it says registration is closed until it is", () => {
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);
    expect(screen.getByRole("note").textContent).toContain("Registration is closed while this event is Planning");
  });

  it("185-S4g: a Confirmed event has no such note", () => {
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings({ status: "confirmed", closedByStatus: false })} />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("185-S4g: an event with no capacity or window yet starts with empty boxes", () => {
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings({ capacity: null, opensAt: null, closesAt: null })} />);
    expect((screen.getByLabelText("Capacity") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Registration opens") as HTMLInputElement).value).toBe("");
  });
});

describe("SCRUM-185/AC4 185-S4d the form checks before it sends", () => {
  it("185-S4d: a closing time after the event starts is refused next to the field, and nothing is sent", () => {
    const fetchMock = mockServer(200, {});
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.change(screen.getByLabelText("Registration closes"), { target: { value: "2031-11-15T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    expect(screen.getByText("Registration must close by the event start.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("185-S4d: an empty capacity and an empty opening time are each refused", () => {
    const fetchMock = mockServer(200, {});
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.change(screen.getByLabelText("Capacity"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Registration opens"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    expect(screen.getByText("Enter the registration capacity.")).toBeTruthy();
    expect(screen.getByText("Enter the registration opening date and time.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-185/AC4 185-S4b saving", () => {
  it("185-S4b: sends the settings as UTC instants, confirms in the form and with a toast, and refreshes the page", async () => {
    const fetchMock = mockServer(200, { capacity: 40, message: "Registration settings saved." });
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.change(screen.getByLabelText("Capacity"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/events\/evt-1\/registration-settings$/);
    expect(init).toMatchObject({ method: "PUT", credentials: "include" });
    expect(JSON.parse(init.body as string)).toEqual({
      registration_capacity: 40,
      registration_opens_at: "2031-10-01T01:00:00.000Z",
      registration_closes_at: "2031-11-13T01:00:00.000Z",
    });
    expect((await screen.findByRole("status")).textContent).toBe("Registration settings saved.");
    expect(toastSuccess).toHaveBeenCalledWith("Registration settings saved.");
  });

  it("185-S4b: a success answer without a message still confirms with a plain one", async () => {
    mockServer(200, { capacity: 40 });
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Registration settings saved."));
  });

  it("185-S4c: the database's refusal is shown next to the capacity and nothing refreshes", async () => {
    mockServer(422, {
      code: "VALIDATION_FAILED",
      error: "5 attendees are already confirmed, so the capacity can't be lower than 5.",
      fieldErrors: { registration_capacity: "5 attendees are already confirmed, so the capacity can't be lower than 5." },
    });
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.change(screen.getByLabelText("Capacity"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    expect(await screen.findByText("5 attendees are already confirmed, so the capacity can't be lower than 5.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("185-S4f: a refusal with no field (a locked event, a form-level message) is shown above the form", async () => {
    mockServer(409, { code: "EVENT_LOCKED", error: "This event is closed, so its registration can't be changed." });
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This event is closed, so its registration can't be changed.");
  });

  it("185-S4f: a refusal with only a form message is shown above the form", async () => {
    mockServer(422, { code: "VALIDATION_FAILED", error: "This event does not take registrations", fieldErrors: { form: "This event does not take registrations" } });
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This event does not take registrations");
  });

  it("185-S4b: an answer with no reason shows a plain retry message", async () => {
    mockServer(500, {});
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save the registration settings. Please try again.");
  });

  it("185-S4b: an unreachable server says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<RegistrationSettingsForm eventId="evt-1" settings={settings()} />);

    fireEvent.click(screen.getByRole("button", { name: "Save registration settings" }));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't reach the server. Please try again.");
  });
});

describe("SCRUM-185/AC4 185-S4b saveRegistrationSettings", () => {
  it("185-S4b: encodes the event id in the path and returns the JSON as is", async () => {
    const fetchMock = mockServer(200, { capacity: 1 });

    const result = await saveRegistrationSettings("a b", { registration_capacity: 1, registration_opens_at: "x", registration_closes_at: "y" });

    expect(result).toEqual({ ok: true, data: { capacity: 1 } });
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/\/events\/a%20b\/registration-settings$/);
  });
});
