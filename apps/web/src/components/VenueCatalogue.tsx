"use client";

import { parseVenueSearchInput, utcToSgt } from "@spm-t5/shared";
import { AlertCircle, CalendarClock, Check, ChevronDown, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { VenueCard, VenueList, type VenueSummary } from "@/components/VenueList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { InputField } from "@/components/ui/input-field";
import { Skeleton } from "@/components/ui/skeleton";
import { VenueChecksList } from "@/components/VenueChecksList";
import { emptyVenueQuery, filterChips, relaxHint, withoutFilter } from "@/lib/venueFilters";
import { venueChecks } from "@/lib/venueChecks";
import { searchVenues, type VenueSearchOptions, type VenueSearchQuery, type VenueSearchResultView } from "@/lib/venueSearch";

interface Props {
  /** The whole catalogue, shown while no search is applied. */
  venues: VenueSummary[];
  /** The layouts and facilities to filter by; absent for a role that may not search, which gets the plain catalogue. */
  options?: VenueSearchOptions;
  /** SCRUM-131/AC1: the event the filters were pre-filled from. The search runs on load. */
  prefill?: { eventName: string; query: VenueSearchQuery; requirements?: string | null };
  /** Replaced by a pretend service in tests; defaults to asking venue-service. */
  search?: typeof searchVenues;
}

// SCRUM-131: the venue search lives inside the catalogue. Filters sit beside the list; once a date range is applied the
// list becomes the venues free for it, with a removable chip for each active filter (AC2) and a hint when none match (AC3).
// The input checks are the shared parseVenueSearchInput, so they match venue-service's word for word (SCRUM-65).
export function VenueCatalogue({ venues, options, prefill, search = searchVenues }: Props) {
  const [draft, setDraft] = useState<VenueSearchQuery>(prefill?.query ?? emptyVenueQuery);
  const [applied, setApplied] = useState<VenueSearchQuery>();
  const [results, setResults] = useState<VenueSearchResultView[]>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(true);

  const run = useCallback(
    async (query: VenueSearchQuery) => {
      setError(undefined);
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
        setApplied(query);
        setResults(data.venues);
      } else if (data.fieldErrors) setFieldErrors(data.fieldErrors);
      else setError(data.error ?? "We couldn't search for venues. Please try again.");
    },
    [search],
  );

  // AC1: an event's filters are applied as soon as the page opens
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefill && !prefilled.current) {
      prefilled.current = true;
      void run(prefill.query);
    }
  }, [prefill, run]);

  const set = (key: "startTime" | "endDate" | "endTime" | "attendance" | "location") => (e: { target: { value: string } }) =>
    setDraft((q) => ({ ...q, [key]: e.target.value }));
  // A one-day search needs one pick: the end date follows the start date while it is empty or would fall before it.
  const setStartDate = (e: { target: { value: string } }) =>
    setDraft((q) => ({ ...q, startDate: e.target.value, endDate: q.endDate === "" || q.endDate < e.target.value ? e.target.value : q.endDate }));
  const toggleFacility = (id: string) =>
    setDraft((q) => ({ ...q, facilityIds: q.facilityIds.includes(id) ? q.facilityIds.filter((f) => f !== id) : [...q.facilityIds, id] }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(draft);
  };

  // AC2: removing a chip clears that filter. Without a period there is nothing to search, so the catalogue comes back.
  const remove = (key: string) => {
    if (!applied) return;
    const next = withoutFilter(applied, key);
    setDraft(next);
    if (!next.startDate) {
      setApplied(undefined);
      setResults(undefined);
      return;
    }
    void run(next);
  };

  // SCRUM-132: listing venues that miss a requirement is a search option, so changing it searches again.
  const toggleUnsuitable = (on: boolean) => {
    if (!applied) return;
    const next = { ...applied, includeUnsuitable: on };
    setDraft((q) => ({ ...q, includeUnsuitable: on }));
    void run(next);
  };

  const reset = () => {
    setDraft(emptyVenueQuery);
    setApplied(undefined);
    setResults(undefined);
    setFieldErrors({});
    setError(undefined);
  };

  const today = utcToSgt(new Date()).date;
  const chips = applied && options ? filterChips(applied, options) : [];
  const byId = new Map(venues.map((v) => [v.id, v]));

  return (
    <div className="flex flex-col gap-4">
      {prefill && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary p-4 text-sm" role="status">
          <CalendarClock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-primary" />
          <div>
            <p className="font-semibold text-foreground">Filters are pre-filled from {prefill.eventName}</p>
            {prefill.requirements && <p className="text-muted-foreground">Venue requirements: {prefill.requirements}</p>}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {options && (
          <Card className="gap-4 px-4">
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls="venue-filters" onClick={() => setOpen((o) => !o)}>
                <SlidersHorizontal aria-hidden="true" />
                Filters
                <ChevronDown aria-hidden="true" className={open ? "rotate-180" : undefined} />
              </Button>
              {open && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
            </div>
            <form id="venue-filters" hidden={!open} className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-label="Venue filters">
              {error && (
                <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                  <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                  {error}
                </p>
              )}

              {/* When is the only required filter, so it gets its own row; people and location follow, then the optional ones. */}
              <div className="flex flex-col gap-4">
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1.5 text-sm font-semibold text-foreground">When</legend>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <InputField id="startDate" label="Start date" type="date" min={today} value={draft.startDate} onChange={setStartDate} error={fieldErrors.startDate} />
                    <InputField id="endDate" label="End date" type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={set("endDate")} error={fieldErrors.endDate} />
                    <InputField id="startTime" label="Start time" type="time" value={draft.startTime} onChange={set("startTime")} error={fieldErrors.startTime} />
                    <InputField id="endTime" label="End time" type="time" value={draft.endTime} onChange={set("endTime")} error={fieldErrors.endTime} />
                  </div>
                </fieldset>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <InputField id="attendance" label="People" type="number" min={1} step={1} inputMode="numeric" value={draft.attendance} onChange={set("attendance")} error={fieldErrors.attendance} />
                <InputField id="location" label="Location" autoComplete="off" value={draft.location} onChange={set("location")} error={fieldErrors.location} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                  {options.layouts.length > 0 && (
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-2 text-sm font-semibold text-foreground">Layout</legend>
                      <div className="flex flex-wrap gap-2">
                        {options.layouts.map((l) => {
                          const on = draft.layoutId === l.id;
                          return (
                            <Button key={l.id} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on}
                              onClick={() => setDraft((q) => ({ ...q, layoutId: on ? "" : l.id }))}>
                              {on && <Check aria-hidden="true" />}
                              {l.name}
                            </Button>
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-semibold text-foreground">Must have</legend>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <Checkbox checked={draft.accessible} onCheckedChange={(c) => setDraft((q) => ({ ...q, accessible: c }))} />
                        Accessible venue
                      </label>
                      {options.facilities.map((f) => (
                        <label key={f.id} className="flex items-center gap-2 text-sm text-foreground">
                          <Checkbox checked={draft.facilityIds.includes(f.id)} onCheckedChange={() => toggleFacility(f.id)} />
                          {f.name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>

              <Button type="submit" className="w-full" disabled={searching}>{searching ? "Searching…" : "Apply filters"}</Button>
            </form>
          </Card>
        )}

        <div className="flex min-w-0 flex-col gap-4">
          {searching && (
            <div className="flex flex-col gap-3" role="status" aria-label="Searching venues">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {!searching && applied && results ? (
            <>
              {chips.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Active filters">
                  {chips.map((c) => (
                    <li key={c.key}>
                      <Badge variant="secondary" className="h-7 gap-1 pr-1 pl-2.5 text-sm">
                        {c.label}
                        <Button type="button" variant="ghost" size="xs" className="size-5 p-0" aria-label={`Remove filter ${c.label}`} onClick={() => remove(c.key)}>
                          <X aria-hidden="true" />
                        </Button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {options && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={Boolean(applied.includeUnsuitable)} onCheckedChange={toggleUnsuitable} />
                  Show unsuitable venues
                </label>
              )}
              {results.length === 0 ? (
                <Card className="items-center py-10 text-center" role="status">
                  <SearchX aria-hidden="true" className="size-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">{relaxHint(applied)}</p>
                </Card>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground" role="status">
                    {results.length} {results.length === 1 ? "venue" : "venues"} free
                  </p>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {results.map((r) => (
                      <li key={r.id}>
                        <VenueCard venue={byId.get(r.id) ?? r}>
                          <ResultDetails venue={r} />
                          {options && <ChecksFor venue={r} query={applied} options={options} />}
                        </VenueCard>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            !searching && <VenueList venues={venues} />
          )}
        </div>
      </div>
    </div>
  );
}

// SCRUM-132: the per-requirement checks; a search with no requirements has nothing to judge.
function ChecksFor({ venue, query, options }: { venue: VenueSearchResultView; query: VenueSearchQuery; options: VenueSearchOptions }) {
  const result = venueChecks(venue, query, options);
  return result.checks.length > 0 ? <VenueChecksList result={result} /> : null;
}

// SCRUM-65/AC7: what a result adds to the catalogue card.
function ResultDetails({ venue: v }: { venue: VenueSearchResultView }) {
  return (
    <dl className="mt-1 flex flex-col gap-0.5 text-sm text-muted-foreground">
      {v.opening_time && v.closing_time && <div>Open {v.opening_time}–{v.closing_time}</div>}
      <div>{v.is_accessible ? "Accessible" : "Not accessible"}{v.accessibility_notes ? ` (${v.accessibility_notes})` : ""}</div>
      {v.layouts.length > 0 && <div>Layouts: {v.layouts.map((l) => `${l.name} (${l.max_capacity})`).join(", ")}</div>}
      {v.facilities.length > 0 && <div>Facilities: {v.facilities.map((f) => f.name).join(", ")}</div>}
    </dl>
  );
}
