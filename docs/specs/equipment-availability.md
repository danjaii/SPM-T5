# Equipment Availability: Final User Story

User story for **Equipment Availability Checking** (ConnectSphere, IS212), compiled 2026-10-06.

- Scenario numbers are the test IDs: `18-S3` means SCRUM-18, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-18 | Check Equipment Availability | none (reads `equipment` and `equipment_reservations` from `01_schema.sql`) |

## Implementation decisions (2026-10-06)

These override the text below where they conflict.

- **Endpoints** (`equipment-service`, port 4004; all need a session, 401 otherwise; any role but
  `technical_support_staff` gets 403) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /equipment` | 200 `EquipmentOption[]` (`id`, `name`, `operationalStatus`), name order, for the name suggestions |
  | `GET /equipment-availability?equipmentName&quantity&date&startTime&endTime` | 200 `AvailabilityResult`, 422 `fieldErrors` |

- **Period.** A date plus a start and end time, Singapore time, same day, like the venue request form. The start must
  not be in the past (compared with the injected clock). **[DECIDED]**
- **Which reservations use up stock.** `approved` and `reserved` only. `requested` is still undecided (it is often the
  very request being checked), and `rejected` / `cancelled` never held anything. A reservation counts for
  `quantity_reserved` when set (staff may approve fewer than asked), otherwise `quantity_requested`. **[DECIDED]**
- **Overlap.** A reservation counts when its period overlaps the checked period (half-open, so back-to-back periods do
  not overlap). **[DECIDED]**
- **Peak, not sum.** Available = total quantity minus the **most units in use at any one moment** of the checked period.
  Two reservations of 4 that both fall inside the period but not at the same time leave 6 of 10 available, not 2.
  **[DECIDED]**
- **Equipment that is not usable.** If `operational_status` is not `available` (damaged, under maintenance, retired),
  the equipment is still found by name, but its available quantity is 0 and the result says why. **[DECIDED]**
- **Name matching.** The name is trimmed and matched against the catalogue ignoring letter case. The form offers the
  catalogue names as suggestions. **[DECIDED]**
- **Quantity.** Required, a whole number of at least 1. The original criteria do not mention it; added so the
  comparison is always possible. **[DECIDED]**
- **Validation is shared.** `parseAvailabilityInput` in `packages/shared` runs in the form and the service, so they
  agree. **[DECIDED]**

---

## SCRUM-18 Check Equipment Availability

**User story.** As a Technical Support Staff, I want to check whether the available quantity of a piece of equipment
meets the quantity requested for a given date and time, so that I can confirm whether an event's equipment needs can be
met.

### Acceptance criteria

*AC1.* Given that I have specified an equipment name, requested quantity, date and time, when I check availability, the
system should compare the requested quantity against the quantity available at that date and time and show me the
available quantity.

*AC2.* Given that the available quantity meets or exceeds the requested quantity, when I check availability, the system
should indicate that the equipment is available.

*AC3.* Given that the available quantity is less than the requested quantity, when I check availability, the system
should indicate that the equipment is insufficient and show me the shortfall.

*AC4.* Given that I have not specified the equipment name, when I attempt to check availability, the system should
prompt me to provide the equipment name.

*AC5.* Given that I have specified an equipment name that does not match any known equipment, when I attempt to check
availability, the system should inform me that the equipment name is invalid.

*AC6.* Given that I have not specified the date and time, when I attempt to check availability, the system should prompt
me to provide the date and time.

*AC7.* Given that I have specified a date and time that is invalid, such as a past date or a malformed time, when I
attempt to check availability, the system should inform me that the date and time entered is invalid.

### Tests

| ID | Scenario |
| --- | --- |
| 18-S1 | 10 in total, 4 approved in the period: 200, available 6, the requested quantity echoed back (AC1). |
| 18-S2 | Requested equals or is below available: `sufficient: true`, shortfall 0 (AC2). |
| 18-S3 | Requested above available: `sufficient: false`, shortfall = requested − available (AC3). |
| 18-S4 | Name missing or only spaces: 422 `fieldErrors.equipmentName` (AC4). |
| 18-S5 | Unknown name: 422 `fieldErrors.equipmentName` saying it does not match any equipment (AC5). |
| 18-S6 | Date, start or end time missing: 422 with the field's prompt (AC6). |
| 18-S7 | Malformed date or time, end not after start, or start in the past: 422 (AC7). |
| 18-S8 | Only `approved` and `reserved` count; `requested`, `rejected`, `cancelled` do not; `quantity_reserved` wins over `quantity_requested`. |
| 18-S9 | Peak: two non-overlapping reservations of 4 inside the period leave 6 of 10; overlapping ones leave 2. Back-to-back reservations do not overlap the period. |
| 18-S10 | Equipment not `available` operationally: found, available 0, reason given. |
| 18-S11 | Name is trimmed and matched ignoring case. |
| 18-S12 | Quantity missing, not a whole number, or below 1: 422 `fieldErrors.quantity`. |
| 18-S13 | No session: 401. Any role other than Technical Support Staff: 403 on both endpoints. |
