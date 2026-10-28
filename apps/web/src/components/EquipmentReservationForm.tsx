"use client";

import { useState, type FormEvent } from "react";
import { periodFormatErrors, periodMissing, periodTimingError, quantityError } from "@spm-t5/shared";
import Link from "next/link";
import { AlertCircle, CalendarDays, Lock, PackageOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/input-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OUT_OF_SERVICE_DISPLAY, type StatusDisplay } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { ApiResult } from "@/lib/api";
import { unusableReason } from "@/lib/equipmentAvailability";
import type {
  EquipmentCardView,
  ReservableEventView,
  ReservationConfirmationView,
  ReservationRequest,
} from "@/lib/equipmentReservation";
import { reserveEquipment } from "@/lib/equipmentReservation";

interface Props {
  /** Approved events that have not started yet. */
  events: ReservableEventView[];
  /** The catalogue, shown as cards. */
  equipment: EquipmentCardView[];
  /** Replaced by a pretend service in tests; defaults to asking equipment-service. */
  reserve?: (reservation: ReservationRequest) => Promise<ApiResult<ReservationConfirmationView>>;
}

// SCRUM-19: Technical Support Staff reserve equipment for an event. Built up one test at a time.
export function EquipmentReservationForm({ events, equipment, reserve = reserveEquipment }: Props) {
  const [eventId, setEventId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [confirmation, setConfirmation] = useState<ReservationConfirmationView>();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /** SCRUM-138/AC1: how many the service says are still free after we reserved an item, by equipment id. */
  const [freeAfter, setFreeAfter] = useState<Record<string, number>>({});

  /** AC6: the cards whose name contains what was typed in the search box, ignoring capital letters. */
  const shownEquipment = equipment.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));

  /** AC8: choosing an event fills in its date and times; the boxes stay editable for a shorter period. */
  function chooseEvent(id: string) {
    setEventId(id);
    const chosen = events.find((event) => event.id === id);
    if (!chosen) return;
    setDate(chosen.date);
    setStartTime(chosen.startTime);
    setEndTime(chosen.endTime);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setConfirmation(undefined);
    setError(undefined);
    const period = { date: date.trim(), startTime: startTime.trim(), endTime: endTime.trim() };

    // The same three stages as equipment-service, so the user sees the same messages: missing, then format, then timing.
    // Stage 1, missing. 19-S9: no event. AC6: no equipment. AC7: no quantity. AC8: no date or time.
    const missing: Record<string, string> = { ...periodMissing(period) };
    if (eventId === "") missing.eventId = "Please select the event.";
    if (selectedEquipmentId === "") missing.equipmentId = "Please select the equipment.";
    if (quantity.trim() === "") missing.quantity = quantityError(quantity)!;
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      return;
    }

    // Stage 2, format: a quantity that is not a whole number of at least 1, or a date or time in the wrong shape.
    const invalid: Record<string, string> = { ...periodFormatErrors(period) };
    const quantityProblem = quantityError(quantity);
    if (quantityProblem) invalid.quantity = quantityProblem;
    if (Object.keys(invalid).length > 0) {
      setFieldErrors(invalid);
      return;
    }

    // Stage 3, timing: the end must be after the start, and the start must not be in the past.
    const timing = periodTimingError(period, new Date());
    if (!timing.ok) {
      setFieldErrors(timing.fieldErrors);
      return;
    }
    setFieldErrors({});

    // AC1: everything is fine, so ask equipment-service to reserve it (it checks again).
    const { ok, data } = await reserve({ eventId, equipmentId: selectedEquipmentId, quantity, date, startTime, endTime });
    // AC2 + AC3: show what was reserved and how many are still free.
    if (ok) {
      setConfirmation(data);
      // SCRUM-138/AC1: the row's free count drops at once, and a toast confirms.
      setFreeAfter((before) => ({ ...before, [selectedEquipmentId]: data.availableAfter }));
      toast.success(`${data.equipmentName}: ${data.quantity} reserved`);
    }
    // AC4: refused (for example not enough is free): tell the user the service's reason. Nothing is confirmed (AC5).
    else setError(data.error);
  }

  const chosen = events.find((event) => event.id === eventId);
  const hasPeriod = date !== "" && startTime !== "" && endTime !== "";

  if (events.length === 0 && equipment.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
        <PackageOpen aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="font-semibold text-foreground">Nothing to reserve yet.</p>
        <p className="text-sm text-muted-foreground">Approved events and catalogue equipment will show up here.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-start">
      {/* The events to reserve for, one card each (Figma frame 11, left column). */}
      <div className="flex flex-col gap-2">
        <p id="eventLabel" className="text-sm font-semibold text-foreground">Event</p>
        <div role="group" aria-labelledby="eventLabel" className="flex flex-col gap-2">
          {events.length === 0 && <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">No approved events that have not started.</p>}
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              aria-pressed={eventId === event.id}
              onClick={() => chooseEvent(event.id)}
              className={cn(
                "flex cursor-pointer flex-col items-start gap-1 rounded-xl border bg-card p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                eventId === event.id ? "border-2 border-primary" : "border-border",
              )}
            >
              <span className="font-semibold text-foreground">{event.name}</span>
              <span className="text-sm text-muted-foreground">{event.date} · {event.startTime} to {event.endTime}</span>
              {event.coordinatorName && <span className="text-sm text-muted-foreground">Coordinator {event.coordinatorName}</span>}
            </button>
          ))}
        </div>
        {fieldErrors.eventId && <p className="text-sm font-medium text-destructive" role="alert">{fieldErrors.eventId}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{chosen ? chosen.name : "Choose the equipment"}</CardTitle>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays aria-hidden="true" className="size-4" />
            {chosen ? `${chosen.date} · ${chosen.startTime} to ${chosen.endTime}${chosen.coordinatorName ? ` · coordinator ${chosen.coordinatorName}` : ""}` : "Pick an event on the left; its date and times fill in below."}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error && <AlertMessage>{error}</AlertMessage>}
          {confirmation && (
            <section role="status" className="flex flex-col gap-1 rounded-lg border border-status-success-fg bg-status-success p-3 text-sm text-status-success-fg">
              {/* AC2 */}
              <h2 className="font-semibold">Reserved</h2>
              <p>
                {confirmation.equipmentName}: {confirmation.quantity} reserved, on {confirmation.date},{" "}
                {confirmation.startTime} to {confirmation.endTime}.
              </p>
              {/* AC3 */}
              <p>{confirmation.availableAfter} still available for that period.</p>
              {/* SCRUM-138/AC2: Technical Support Staff cannot open event pages, so the link goes to the Inventory for the same period, which names the event holding the units */}
              <Link href={`/equipment-inventory?${new URLSearchParams({ date: confirmation.date, startTime: confirmation.startTime, endTime: confirmation.endTime })}`} className="font-semibold underline underline-offset-4 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
                See it in the Inventory for that period
              </Link>
            </section>
          )}

          <InputField id="equipmentSearch" label="Search equipment" type="search" autoComplete="off" value={search} onChange={(e) => setSearch(e.target.value)} />

          {/* AC6: one row per catalogue item; pressing the name chooses it */}
          <div>
            <p className="mb-1.5 text-sm font-semibold text-foreground" id="equipmentLabel">Select equipment</p>
            {shownEquipment.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">No equipment matches that search.</p>
            ) : (
              <Table aria-labelledby="equipmentLabel">
                <TableHeader className="max-md:sr-only">
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Free at that time</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownEquipment.map((item) => {
                    const unusable = unusableReason(item.operationalStatus) !== null;
                    const statusDisplay: StatusDisplay = unusable
                      ? (OUT_OF_SERVICE_DISPLAY as Record<string, StatusDisplay>)[item.operationalStatus] ?? { tone: "neutral", icon: "circle", label: item.operationalStatus }
                      : { tone: "success", icon: "check", label: "Available" };
                    return (
                      <TableRow key={item.id} className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-3">
                        <TableCell className="whitespace-normal max-md:p-0">
                          <button
                            type="button"
                            disabled={unusable}
                            aria-pressed={selectedEquipmentId === item.id}
                            onClick={() => setSelectedEquipmentId(selectedEquipmentId === item.id ? "" : item.id)}
                            className={cn(
                              "cursor-pointer rounded-md border px-2.5 py-1 text-left font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
                              selectedEquipmentId === item.id ? "border-2 border-primary bg-secondary text-fg-primary" : "border-border bg-card text-foreground hover:bg-accent",
                            )}
                          >
                            {item.name}
                          </button>
                          {item.type && <span className="mt-1 block text-sm text-muted-foreground">{item.type}</span>}
                        </TableCell>
                        <TableCell className="font-semibold max-md:p-0">
                          {item.id in freeAfter ? `${freeAfter[item.id]} of ${item.totalQuantity}` : <span className="font-normal text-muted-foreground">{item.totalQuantity} in total</span>}
                        </TableCell>
                        <TableCell className="max-md:p-0"><StatusBadge {...statusDisplay} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {fieldErrors.equipmentId && <p className="mt-1.5 text-sm font-medium text-destructive" role="alert">{fieldErrors.equipmentId}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <InputField id="quantity" label="Quantity required" type="number" min={1} step={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} error={fieldErrors.quantity} className="sm:col-span-2" />
            <InputField id="date" label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={fieldErrors.date} className="sm:col-span-2" />
            <InputField id="startTime" label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} error={fieldErrors.startTime} />
            <InputField id="endTime" label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} error={fieldErrors.endTime} />
          </div>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-3">
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock aria-hidden="true" className="size-4" />
            {hasPeriod ? "Reserved units are held for this event and its times." : "Reserved units are held for the event you choose."}
          </p>
          <Button type="submit">Reserve equipment</Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function AlertMessage({ children }: { children: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive bg-status-danger p-3 text-sm font-medium text-status-danger-fg">
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
