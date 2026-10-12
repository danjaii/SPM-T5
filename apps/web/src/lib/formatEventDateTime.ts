// SCRUM-71/AC4: event times are shown in Singapore time, whatever time zone the server runs in
const TIME_ZONE = "Asia/Singapore";

// Built from parts rather than format(): format()'s punctuation and spacing differ between ICU versions
// (e.g. a narrow no-break space before "PM"), and the AC fixes the exact text.
const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true });

function partsOf(format: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]));
}

/** "Sat, 12 Dec 2026" */
export function formatDate(date: Date): string {
  const { weekday, day, month, year } = partsOf(dateFormat, date);
  return `${weekday}, ${day} ${month} ${year}`;
}

/** "7:00 PM" */
function formatTime(date: Date): string {
  const { hour, minute, dayPeriod } = partsOf(timeFormat, date);
  return `${hour}:${minute} ${dayPeriod.toUpperCase()}`;
}

/** SCRUM-71/AC4: "Sat, 12 Dec 2026, 7:00 PM – 9:00 PM", or "Sat, 12 Dec 2026, 7:00 PM" with no end time */
export function formatEventDateTime(startAt: string, endAt: string | null): string {
  const start = `${formatDate(new Date(startAt))}, ${formatTime(new Date(startAt))}`;
  return endAt ? `${start} – ${formatTime(new Date(endAt))}` : start;
}
