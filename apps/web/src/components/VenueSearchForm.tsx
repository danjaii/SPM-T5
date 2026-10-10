"use client";

import { useState, type FormEvent } from "react";
import { parseVenueSearchInput, utcToSgt } from "@spm-t5/shared";
import { Field } from "./Field";
import { VenueSearchResults } from "./VenueSearchResults";
import {
  searchVenues,
  type VenueSearchOptions,
  type VenueSearchQuery,
  type VenueSearchResultView,
} from "@/lib/venueSearch";

interface Props {
  /** The layouts and facilities to choose from. */
  options: VenueSearchOptions;
  /** Replaced by a pretend service in tests; defaults to asking venue-service. */
  search?: typeof searchVenues;
}

// SCRUM-65: an Event Coordinator searches for venues free for a period that meet the event's requirements.
// The input checks are the shared parseVenueSearchInput, so the prompts appear straight away and match
// venue-service's word for word (AC4, AC5, AC6).
export function VenueSearchForm({ options, search = searchVenues }: Props) {
  const [query, setQuery] = useState<VenueSearchQuery>({
    startDate: "",
    startTime: "09:00",
    endDate: "",
    endTime: "17:00",
    attendance: "",
    location: "",
    layoutId: "",
    accessible: false,
    facilityIds: [],
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [venues, setVenues] = useState<VenueSearchResultView[]>();
  const [searching, setSearching] = useState(false);

  const set = (key: "startTime" | "endDate" | "endTime" | "attendance" | "location" | "layoutId") =>
    (e: { target: { value: string } }) => setQuery((q) => ({ ...q, [key]: e.target.value }));

  // A one-day search needs one pick: the end date follows the start date while it is empty or would fall before it.
  const setStartDate = (e: { target: { value: string } }) =>
    setQuery((q) => {
      const startDate = e.target.value;
      return { ...q, startDate, endDate: q.endDate === "" || q.endDate < startDate ? startDate : q.endDate };
    });

  const today = utcToSgt(new Date()).date;

  const toggleFacility = (id: string) =>
    setQuery((q) => ({
      ...q,
      facilityIds: q.facilityIds.includes(id) ? q.facilityIds.filter((f) => f !== id) : [...q.facilityIds, id],
    }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setVenues(undefined);

    // AC4, AC5, AC6: anything missing or wrong is shown straight away, without asking the service.
    const parsed = parseVenueSearchInput(query, new Date());
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    setSearching(true);
    const { ok, data } = await search(query);
    setSearching(false);
    if (ok) {
      setVenues(data.venues);
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    else setError(data.error ?? "We couldn't search for venues. Please try again.");
  }

  return (
    <div>
      <form className="auth__form venue-search" onSubmit={onSubmit} noValidate style={{ maxWidth: 480, marginBottom: 32 }}>
        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        {/* AC5: min greys out days before today (Singapore time), so a past date cannot be picked. The end date
            cannot be picked before the start date either (AC6). */}
        <Field id="startDate" label="Start date" type="date" min={today}
          value={query.startDate} onChange={setStartDate} error={fieldErrors.startDate} />
        <Field id="startTime" label="Start time" type="time"
          value={query.startTime} onChange={set("startTime")} error={fieldErrors.startTime} />
        <Field id="endDate" label="End date" type="date" min={query.startDate || today}
          value={query.endDate} onChange={set("endDate")} error={fieldErrors.endDate} />
        <Field id="endTime" label="End time" type="time"
          value={query.endTime} onChange={set("endTime")} error={fieldErrors.endTime} />

        {/* AC2 + AC3: optional filters */}
        <Field id="attendance" label="Expected attendance (optional)" type="number" min={1} step={1} inputMode="numeric"
          value={query.attendance} onChange={set("attendance")} error={fieldErrors.attendance} />
        <Field id="location" label="Location (optional)" autoComplete="off"
          value={query.location} onChange={set("location")} error={fieldErrors.location} />

        <div className="field">
          <label htmlFor="layoutId">Room layout (optional)</label>
          <select id="layoutId" name="layoutId" value={query.layoutId} onChange={set("layoutId")}>
            <option value="">Any layout</option>
            {options.layouts.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>
            <input type="checkbox" name="accessible" checked={query.accessible}
              onChange={(e) => setQuery((q) => ({ ...q, accessible: e.target.checked }))} />{" "}
            Accessible venues only
          </label>
        </div>

        {options.facilities.length > 0 && (
          <fieldset className="field">
            <legend>Required facilities (optional)</legend>
            {options.facilities.map((f) => (
              <label key={f.id}>
                <input type="checkbox" name="facilityIds" value={f.id} checked={query.facilityIds.includes(f.id)}
                  onChange={() => toggleFacility(f.id)} />{" "}
                {f.name}
              </label>
            ))}
          </fieldset>
        )}

        <button className="btn" type="submit" disabled={searching}>
          {searching ? "Searching…" : "Search venues"}
        </button>
      </form>

      {venues && <VenueSearchResults venues={venues} />}
    </div>
  );
}
