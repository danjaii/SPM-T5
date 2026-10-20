import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileForm } from "@/components/ProfileForm";
import type { ProfileView } from "@/lib/profile";

// ----------------------------------------------------------------------------
// Test setup: a signed-in coordinator's profile
// ----------------------------------------------------------------------------

const profile: ProfileView = {
  fullName: "Rachel Tan",
  email: "rachel@example.com",
  loginEmail: "rachel@example.com",
  phone: "+65 8100 2000",
  communicationPreferences: { email: true, sms: false },
  role: "event_coordinator",
  organisation: null,
  department: null,
  responsibilities: [],
};

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-68 profile form (docs/specs/user-profile.md)
// ----------------------------------------------------------------------------

describe("SCRUM-68/AC1 profile form: viewing", () => {
  // Opening the profile shows the person's own details, ready to edit, and their role.
  it("68-S1: shows the name, contact email, phone, communication preferences and role", () => {
    render(<ProfileForm profile={profile} save={vi.fn()} />);

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Rachel Tan");
    expect((screen.getByLabelText("Contact email") as HTMLInputElement).value).toBe("rachel@example.com");
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe("+65 8100 2000");
    expect((screen.getByRole("checkbox", { name: "Email" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "SMS" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Event Coordinator")).toBeTruthy();
  });
  // An Event Organiser also sees the organisation they belong to. It is information only, not a box to type in.
  it("68-S2: also shows an Event Organiser's organisation, as plain text", () => {
    const organiser: ProfileView = { ...profile, role: "event_organiser", organisation: { name: "TechConnect Pte Ltd" } };

    render(<ProfileForm profile={organiser} save={vi.fn()} />);

    expect(screen.getByText("Organisation")).toBeTruthy();
    expect(screen.getByText("TechConnect Pte Ltd")).toBeTruthy();
    // for an event organiser whose organisation is TechConnect, the form shows an organisation line with that name 
    expect(screen.queryByLabelText("Organisation")).toBeNull(); // no box to type in
  });
  // The role and the organisation cannot be changed from the profile, so the form gives no way to try: the only boxes to type in
  // are the name, the contact email and the phone.
  it("68-S15/S17: gives no box to change the role or the organisation", () => {
    const organiser: ProfileView = { ...profile, role: "event_organiser", organisation: { name: "TechConnect Pte Ltd" } };

    render(<ProfileForm profile={organiser} save={vi.fn()} />);

    const boxes = screen.getAllByRole("textbox").map((box) => (box as HTMLInputElement).id);
    expect(boxes).toEqual(["fullName", "email", "phone"]);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  // The email on the profile is only for contact. When it is not the address the person signs in with, the form says which one
  // they still sign in with, so they are not caught out.
  it("68-S20: says which email the person still signs in with when it differs from the contact email", () => {
    const contactDiffers: ProfileView = { ...profile, email: "rachel.contact@example.com", loginEmail: "rachel@example.com" };

    render(<ProfileForm profile={contactDiffers} save={vi.fn()} />);

    expect(screen.getByText("You still sign in with rachel@example.com.")).toBeTruthy();
  });

  // A staff member sees their department and what their role is responsible for, as plain text.
  it("69-S7: shows a staff member's department and responsibilities", () => {
    const staff: ProfileView = {
      ...profile,
      department: "Event Coordination",
      responsibilities: ["Search for venues and submit venue booking requests", "Monitor the outstanding arrangements and confirm the event"],
    };

    render(<ProfileForm profile={staff} save={vi.fn()} />);

    expect(screen.getByText("Department")).toBeTruthy();
    expect(screen.getByText("Event Coordination")).toBeTruthy();
    expect(screen.getByText("Responsibilities")).toBeTruthy();
    expect(screen.getByText("Search for venues and submit venue booking requests")).toBeTruthy();
    expect(screen.getByText("Monitor the outstanding arrangements and confirm the event")).toBeTruthy();
  });

  // If no department is recorded for a staff member, the page says so. That is the point of the story: they can see whether
  // their role information is recorded.
  it("69-S8: says 'Not recorded' when a staff member has no department", () => {
    const staff: ProfileView = { ...profile, department: null, responsibilities: ["Reserve equipment for events"] };

    render(<ProfileForm profile={staff} save={vi.fn()} />);

    expect(screen.getByText("Department")).toBeTruthy();
    expect(screen.getByText("Not recorded")).toBeTruthy();
  });

  // The responsibilities are stored for each role. If none are stored for a staff member's role, the page says so, just as it
  // does for a missing department.
  it("69-S10: says 'Not recorded' when no responsibilities are stored for a staff member's role", () => {
    const staff: ProfileView = { ...profile, department: "Event Coordination", responsibilities: [] };

    render(<ProfileForm profile={staff} save={vi.fn()} />);

    expect(screen.getByText("Responsibilities")).toBeTruthy();
    expect(screen.getByText("Not recorded")).toBeTruthy();
  });

  // Event Organisers and Attendees are not staff, so they see neither line. Only the role (and, for organisers, the organisation)
  // describe them.
  it.each(["event_organiser", "attendee"] as const)("69-S9: shows no department or responsibilities to a %s", (role) => {
    const outsider: ProfileView = { ...profile, role, department: null, responsibilities: [] };

    render(<ProfileForm profile={outsider} save={vi.fn()} />);

    expect(screen.queryByText("Department")).toBeNull();
    expect(screen.queryByText("Responsibilities")).toBeNull();
  });
  // end of viewing
});
describe("SCRUM-68/AC4,AC5 profile form: checking before saving", () => {
  // As soon as the person leaves the email box with something that is not an email address, the form says that box is wrong.
  // They find out before they press Save.
  it("68-S8: says the email is not valid when the person leaves that box", () => {
    render(<ProfileForm profile={profile} save={vi.fn()} />);
    const email = screen.getByLabelText("Contact email");

    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.blur(email);

    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
  });
  // The same happens for the other boxes: a phone that is not a phone number, and the name or the email left empty.
  it.each([
    ["68-S9", "Phone", "abc", "Enter a valid contact number."],
    ["68-S10", "Name", "", "Name is required."],
    ["68-S11", "Contact email", "", "Email is required."],
  ])("%s: says the %s box is wrong when the person leaves it like that", (_id, label, value, message) => {
    render(<ProfileForm profile={profile} save={vi.fn()} />);
    const box = screen.getByLabelText(label);

    fireEvent.change(box, { target: { value } });
    fireEvent.blur(box);

    expect(screen.getByText(message)).toBeTruthy();
  });

  // Once the person corrects the box and leaves it again, the message goes away.
  it("68-S8: takes the message away once the email is corrected", () => {
    render(<ProfileForm profile={profile} save={vi.fn()} />);
    const email = screen.getByLabelText("Contact email");
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.blur(email);

    fireEvent.change(email, { target: { value: "rachel.new@example.com" } });
    fireEvent.blur(email);

    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
  });
  // end of checking before saving
});
describe("SCRUM-68/AC6 profile form: saving", () => {
  // Pressing Save with a box that is wrong sends nothing at all. The wrong box is pointed out, and the rest of the form is left as it is.
  it("68-S12: does not send anything when Save is pressed with a wrong box, and points out which one", () => {
    const save = vi.fn();
    render(<ProfileForm profile={profile} save={save} />);

    fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Rachel Tan");
  });
  // With everything valid, Save sends the details as they now are to the service, and tells the person it worked.
  it("68-S4: sends the new details and confirms 'Profile updated.' when everything is valid", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, data: { ...profile, fullName: "Rachel Lim" } });
    render(<ProfileForm profile={profile} save={save} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rachel Lim" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "SMS" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Profile updated.")).toBeTruthy();
    expect(save).toHaveBeenCalledWith({
      fullName: "Rachel Lim",
      email: "rachel@example.com",
      phone: "+65 8100 2000",
      communicationPreferences: { email: true, sms: true },
      // we want to make sure the user knows when the change is successful 
    });
  });
  // If the service refuses (here: another profile already has that email), the message it gives is shown next to the box it is
  // about, and the person is NOT told the profile was updated.
  it("68-S7: shows the service's message next to the email box, and does not say 'Profile updated.'", async () => {
    const taken = "That email address is already in use.";
    const save = vi.fn().mockResolvedValue({ ok: false, data: { error: taken, fieldErrors: { email: taken } } });
    render(<ProfileForm profile={profile} save={save} />);

    fireEvent.change(screen.getByLabelText("Contact email"), { target: { value: "priya@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(taken)).toBeTruthy();
    expect(screen.queryByText("Profile updated.")).toBeNull();
  });
  // If the save fails for a reason that is not about one box (the database could not save, or the service could not be
  // reached), the service's own message is shown at the top of the form, and the person is NOT told the profile was updated.
  it.each([
    ["the database could not save", "We couldn't save your profile. Please try again."],
    ["the service could not be reached", "We couldn't reach the server. Please try again."],
  ])("68-S13: shows a message at the top, not 'Profile updated.', when %s", async (_why, message) => {
    const save = vi.fn().mockResolvedValue({ ok: false, data: { error: message } });
    render(<ProfileForm profile={profile} save={save} />);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.queryByText("Profile updated.")).toBeNull();
  });
  // On the real page nothing pretend is plugged in, so pressing Save should contact the real auth-service. Here nothing is
  // really sent: we only check that it tried the right address, with the right kind of request.
  describe("without a pretend save", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("68-S4: contacts auth-service when Save is pressed", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => profile });
      vi.stubGlobal("fetch", fetchMock);
      render(<ProfileForm profile={profile} />);

      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:4001/profile");
      expect(options.method).toBe("PATCH");
    });
  });
  // end of saving
});
// end of SCRUM-68 profile form

describe("SCRUM-122/AC13 profile form: new design keeps the behaviour", () => {
  // Status is never colour alone (shared AC6): the role badge carries an icon as well as the label.
  it("13-S2: shows the role as a badge with an icon, and the two cards", () => {
    const { container } = render(<ProfileForm profile={profile} save={vi.fn()} />);

    const badge = screen.getByText("Event Coordinator").closest('[data-slot="badge"]')!;
    expect(badge.querySelector("svg")).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="card"]').length).toBe(2);
    expect(screen.getByRole("region", { name: "Your role" })).toBeTruthy();
  });
  // A failed save is shown with an icon and text, and the person's typing is kept.
  it("13-S3: shows a failed save as an alert and keeps what was typed", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, data: { error: "Could not save." } });
    render(<ProfileForm profile={profile} save={save} />);

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+65 9000 0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Could not save.");
    expect((screen.getByLabelText("Phone") as HTMLInputElement).value).toBe("+65 9000 0000");
  });
});
