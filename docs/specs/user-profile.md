# User Profile: Final User Stories

User stories for **View and Update Profile** (SCRUM-68) and **View Department and Responsibilities for Internal Users**
(SCRUM-69) (ConnectSphere, IS212), compiled 2026-10-07 and 2026-10-08.

- Scenario numbers are the test IDs: `68-S3` means SCRUM-68, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-68 | View and Update Profile | none (reads and writes `users` from `01_schema.sql`; the column grants in `03_users_role_privilege.sql` already stop a user changing their role) |
| SCRUM-69 | View Department and Responsibilities for Internal Users | SCRUM-68 (adds two read-only lines to its page and its `GET /profile`) |

SCRUM-69 is written below the SCRUM-68 scenarios.

## Implementation decisions (2026-10-07)

These override the text below where they conflict.

- **Endpoints** (`auth-service`, port 4001, which owns the `users` row and already identifies the caller; both need a
  session, 401 otherwise, and any role may use them) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /profile` | 200 `Profile` |
  | `PATCH /profile` (body: any of `fullName`, `email`, `phone`, `communicationPreferences`) | 200 the updated `Profile`, 422 `fieldErrors`, 409 email already in use |

  `Profile` is `fullName`, `email` (the contact email), `loginEmail`, `phone` (`null` when none),
  `communicationPreferences` (`{ email, sms }`, both booleans), `role`, and `organisation` (`{ name }` for an Event
  Organiser, `null` for every other role).
- **Which fields can change.** Only `fullName`, `email`, `phone` and `communicationPreferences`. **[DECIDED]**
- **Role and organisation cannot be changed.** A request that contains `role` or `organisation` (or any field not
  listed above) is **refused with 422 and nothing is saved**, not silently ignored, the same as SCRUM-12's refusal of a
  non-attendee role. The page shows the role and organisation as plain text, with no input. The database backs this
  up: `03_users_role_privilege.sql` leaves `role` and `organisation_id` unwritable for a signed-in user. **[DECIDED]**
- **The profile email is a contact email; the login email does not change.** The user signs in with the email held by
  Supabase Auth, which owns credentials and is never touched here. Changing the email on the profile changes only
  `users.email`, the address the user is contacted on (and the one the registration form pre-fills). So the two can
  differ. There is **no confirmation link** (out of scope). The page labels it "Contact email" and, when it differs
  from the login email, adds the hint "You still sign in with <login email>." **[DECIDED]**
- **Not verified.** The contact email is not confirmed by the user. Confirming it, and letting a user change the login
  email, are future work. **[DECIDED]**
- **Unique.** `users.email` is unique, so an address already held by another profile is refused with 409 "That email
  address is already in use." and nothing is saved. **[DECIDED]**
- **How it is saved.** `users.email` is deliberately not writable by a signed-in user (`03_users_role_privilege.sql`),
  so the service saves the name, email, phone and preferences in **one update with the secret key**, limited to the
  caller's own row and to the validated fields only, so a failed email leaves nothing half-saved. Because the database
  grant no longer guards `role` and `organisation_id` on this path, the endpoint refuses any other field (68-S14,
  68-S16). Validation runs before any write. **[PROPOSED]**
- **Rules** (shared by the page and the service, in `packages/shared`) **[DECIDED]**:
  - `fullName`: required; spaces alone do not count. Message: "Name is required."
  - `email`: required, trimmed and lower-cased, and must look like an email address. Messages: "Email is required."
    and "Enter a valid email address."
  - `phone`: optional (an empty box clears it). When given, the same rule as the registration form (SCRUM-83): an
    optional `+`, then 8 to 15 digits, with single spaces or hyphens allowed between them. Message: "Enter a valid
    contact number."
  - `communicationPreferences`: exactly `email` and `sms`, each true or false.
- **Before saving.** The page shows which field is invalid when the user leaves the field, and again when they press
  Save. Pressing Save with an invalid or empty required field does not contact the service and keeps the saved
  details on screen. **[DECIDED]**
- **Confirmation.** A successful save shows "Profile updated." on the page. **[DECIDED]**
- **CORS.** `auth-service` currently allows only `GET,POST,OPTIONS`; `PATCH` is added. **[DECIDED]**
- **Where it lives.** A `/profile` page, reached from a "My profile" link on every role's dashboard. **[PROPOSED]**
- **Role names** on the page are the readable ones (Event Organiser, Event Coordinator, Venue Staff, Technical Support
  Staff, Attendee). **[PROPOSED]**

---

## SCRUM-68 View and Update Profile

**User story.** As a registered user, I want to view and update my profile, so that I am identified and contacted using
my accurate details.

### Acceptance criteria

*AC1.* Given that I have logged in, when I open my profile, I should see my name, contact details, communication
preferences, and role.

*AC2.* Given that I am an Event Organiser, when I open my profile, I should also see my organisation.

*AC3.* Given that I edit my name, contact details or communication preferences with valid values, when I save, the
system should update my profile and confirm the change.

*AC4.* Given that I am editing my profile, when I enter an email address or phone number in an invalid format, the
system should indicate which field is invalid before I save.

*AC5.* Given that I am editing my profile, when I clear my name or email address, the system should indicate that the
field is required before I save.

*AC6.* Given that my profile has an invalid or empty required field, when I attempt to save, the system should not save
my changes and should keep my previous details.

*AC7.* Given that I am viewing my profile, when I try to change my role, the system should not allow it.

*AC8.* Given that I am an Event Organiser, when I attempt to change my organisation, the system should not allow it.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 68-S1 | AC1 | Any signed-in user opens their profile | name, contact email, phone, both preferences and the role are shown |
| 68-S2 | AC2 | An Event Organiser opens their profile | their organisation's name is also shown |
| 68-S3 | AC2 | Any other role opens their profile | no organisation is shown |
| 68-S4 | AC3 | Valid new name, phone and preferences are saved | the profile is updated and "Profile updated." is shown |
| 68-S5 | AC3 | A valid new contact email is saved | the contact email changes; the login email is unchanged |
| 68-S6 | AC3 | The phone box is cleared and saved | the phone is removed (no contact number) |
| 68-S7 | AC3 | An email already held by another profile is saved | 409 "That email address is already in use.", nothing is saved |
| 68-S8 | AC4 | An invalid email is typed | "Enter a valid email address." is shown next to the email before saving |
| 68-S9 | AC4 | An invalid phone number is typed | "Enter a valid contact number." is shown next to the phone before saving |
| 68-S10 | AC5 | The name is cleared | "Name is required." is shown before saving |
| 68-S11 | AC5 | The email is cleared | "Email is required." is shown before saving |
| 68-S12 | AC6 | Save is pressed with an invalid or empty required field | the service is not contacted and the saved details stay on screen |
| 68-S13 | AC6 | The service receives an invalid or empty required field | 422 `fieldErrors`, nothing is saved, the previous details are kept |
| 68-S14 | AC7 | A request contains `role` | 422, nothing is saved, the role is unchanged |
| 68-S15 | AC7 | The page is viewed | the role is plain text, with no way to edit it |
| 68-S16 | AC8 | An Event Organiser's request contains `organisation` | 422, nothing is saved, the organisation is unchanged |
| 68-S17 | AC8 | The page is viewed by an Event Organiser | the organisation is plain text, with no way to edit it |
| 68-S18 | (none) | Not signed in | 401 from the service; the page sends the visitor to sign in |
| 68-S19 | (none) | Only some fields are sent | only those fields change; the others keep their values |
| 68-S20 | AC1 | The contact email differs from the login email | the page also says "You still sign in with <login email>." |

---

## SCRUM-69 View Department and Responsibilities for Internal Users

**User story.** As an internal user, I want to see my department and responsibilities on my profile, so that I can
confirm my role information is recorded correctly.

### Implementation decisions (2026-10-08)

- **Who is internal.** The five roles CLAUDE.md marks Internal: `event_coordinator`, `event_coordinator_lead`,
  `venue_staff`, `technical_support_staff` and `safety_officer`. The last two of the five are the new roles from the
  customer's week 7 changes (changes 5 and 6), added to the shared `ROLES` list and, by migration 16, to the database.
  `isInternalRole` in `packages/shared` says so, so the page and the service agree. **[DECIDED]**
- **Department** is the stored `users.department` (for example "Event Coordination", "Venue Operations", "Technical
  Support"). It is read-only: the profile update already refuses a `department` field (68-S14/S16). **[DECIDED]**
- **Responsibilities** are not stored anywhere (there is no column). They are fixed text for each internal role, kept
  once in `packages/shared` (one entry per role, so a role cannot be left out) and taken from the Week 1 Customer Briefing
  (its "Main Responsibility" table and event planning process) and the week 7 customer changes. The Event Coordinator no
  longer "assigns coordinators": that moved to the Event Coordinator Lead. **[PROPOSED]** Confirm with the team that fixed
  text for each role is acceptable.
- **Migration 16** only adds the two role values. Accounts and departments for them, login, dashboards and access rules belong to
  their own stories (SCRUM-75 and the Safety Officer stories). Until then their dashboard is empty and they are not offered on
  the sign-in role picker. **[DECIDED]**
- **Response.** `GET /profile` also returns `department` (`string | null`) and `responsibilities` (`string[]`).
  For an external role (Event Organiser, Attendee) they are `null` and `[]`, whatever the stored data says.
  **[DECIDED]**
- **On the page.** An internal user sees "Department" and "Responsibilities" (a short list) as plain text, next to the
  role. If no department is recorded the page says "Not recorded", because the point of the story is to let the user
  see whether their role information is recorded correctly. External users see neither line. **[DECIDED]**

### Acceptance criteria

*AC1.* Given that I am an internal user, when I open my profile, I should see my department and responsibilities.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 69-S1 | AC1 | `isInternalRole` is asked about each role | true for coordinator, venue staff and technical support; false for organiser and attendee |
| 69-S2 | AC1 | The responsibilities of each internal role are asked for | each role gets its own list, taken from the roles table in CLAUDE.md |
| 69-S3 | AC1 | The responsibilities of an external role are asked for | an empty list |
| 69-S4 | AC1 | An internal user's `GET /profile` | includes their department and their role's responsibilities |
| 69-S5 | AC1 | An external user's `GET /profile` | `department` is `null` and `responsibilities` is `[]`, even if a department is stored |
| 69-S6 | AC1 | An internal user with no department recorded opens `GET /profile` | `department` is `null` |
| 69-S7 | AC1 | An internal user opens the profile page | Department and Responsibilities are shown as plain text |
| 69-S8 | AC1 | An internal user with no department recorded opens the page | the Department line says "Not recorded" |
| 69-S9 | AC1 | An Event Organiser or Attendee opens the page | neither line is shown |
