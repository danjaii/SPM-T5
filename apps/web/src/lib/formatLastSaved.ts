/** SCRUM-53/AC3: "4 Mar 2031, 1:06 pm" in Singapore time, the same format as the Submitted row on the event page. */
export const formatLastSaved = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });
