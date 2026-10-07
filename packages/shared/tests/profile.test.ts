import { describe, expect, it } from "vitest";
import { validateProfileUpdate } from "../src/profile";

// ----------------------------------------------------------------------------
// SCRUM-68 profile rules (docs/specs/user-profile.md): the same checks run on the profile page and in auth-service
// ----------------------------------------------------------------------------

describe("SCRUM-68/AC5 profile rules: required name", () => {
  // When someone clears their name box and tries to save, they are told the name is required.
  it("68-S10: refuses an empty name with 'Name is required.'", () => {
    expect(validateProfileUpdate({ fullName: "" })).toEqual({
      // we make full name to be empty
      ok: false,
      errors: { fullName: "Name is required." },
      // show the error message
    });
  });
  // end of required name
});
describe("SCRUM-68/AC5 profile rules: required email", () => {
  // When someone clears their email box and tries to save, they are told the email is required.
  it("68-S11: refuses an empty email with 'Email is required.'", () => {
    expect(validateProfileUpdate({ email: "" })).toEqual({
      ok: false,
      errors: { email: "Email is required." },
      // if email is empty, show error
    });
  });
  // end of required email
});
describe("SCRUM-68/AC4 profile rules: email format", () => {
  // When someone types something that does not look like an email address, they are told which box is wrong.
  it("68-S8: refuses an email that is not in a valid format with 'Enter a valid email address.'", () => {
    expect(validateProfileUpdate({ email: "not-an-email" })).toEqual({
      ok: false,
      errors: { email: "Enter a valid email address." },
      // if email is a random bunch of text, show error
    });
  });
  // end of email format

  // A valid email is tidied before it is saved: spaces around it are dropped and capital letters become small ones,
  // the same way sign-in treats the login email.
  it("68-S4: accepts a valid email, tidied up (spaces dropped, lower case)", () => {
    expect(validateProfileUpdate({ email: "  Ada.Lim@Example.COM " })).toEqual({
      ok: true,
      update: { email: "ada.lim@example.com" },
      // should accept a valid email and tidy it up, if there is white spaces, we do trim
    });
  });
  // end of email tidy
});
describe("SCRUM-68/AC4 profile rules: phone format", () => {
  // When someone types a contact number that is not a phone number, they are told which box is wrong.
  it("68-S9: refuses a phone number that is not in a valid format with 'Enter a valid contact number.'", () => {
    expect(validateProfileUpdate({ phone: "abc" })).toEqual({
      ok: false,
      errors: { phone: "Enter a valid contact number." },
      // if phone number is abc, we reject and show error
    });
  });
  // end of phone format

  // The phone is optional: clearing the box is allowed, and means "no contact number" (saved as nothing, not as blank text).
  it("68-S6: accepts an empty phone, and turns it into no phone at all", () => {
    expect(validateProfileUpdate({ phone: "" })).toEqual({ ok: true, update: { phone: null } });
    // make phone contact optional, since users can provide email instead
  });
  // end of empty phone
});
describe("SCRUM-68/AC3 profile rules: communication preferences", () => {
  // The two choices (email and SMS) can only be on or off. Anything else is refused, and the error is shown next to the choices.
  it("68-S4: refuses a communication preference that is not on or off", () => {
    expect(validateProfileUpdate({ communicationPreferences: { email: "yes", sms: true } })).toEqual({
      ok: false,
      errors: { communicationPreferences: "Choose on or off for email and SMS." },
    });
  });
  // end of communication preferences
});
describe("SCRUM-68/AC7,AC8 profile rules: details that cannot be changed", () => {
  // Only name, email, phone and preferences can be changed. A request that also tries to change the role, the organisation
  // or the department is refused outright (not quietly ignored), so nobody believes it worked.
  it.each(["role", "organisation", "department"])("68-S14/S16: refuses a request that tries to change %s", (field) => {
    expect(validateProfileUpdate({ [field]: "anything" })).toEqual({
      ok: false,
      errors: { [field]: "This can't be changed." },
      // prevent the changing of role, org, dept
    });
  });
  // end of details that cannot be changed
});
// end of SCRUM-68 profile rules
