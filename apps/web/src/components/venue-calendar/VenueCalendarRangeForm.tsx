import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import type { CalendarQuery } from "@/lib/venueCalendar";

// SCRUM-84/AC5: the dates to show. A start date alone is that one day; with an end date it is the range, both days included.
export function VenueCalendarRangeForm({ busy, onSubmit }: { busy: boolean; onSubmit: (query: CalendarQuery) => void }) {
  return (
    <form
      aria-label="Date range"
      className="flex flex-wrap items-end gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit({ from: String(data.get("from")), to: String(data.get("to")) });
      }}
    >
      <InputField id="calendar-from" name="from" label="Start date" type="date" />
      <InputField id="calendar-to" name="to" label="End date" type="date" helper="Leave the end date empty to see a single day." />
      <Button type="submit" disabled={busy}>Show calendar</Button>
    </form>
  );
}
