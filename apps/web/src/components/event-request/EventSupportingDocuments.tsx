"use client";

import { SupportingDocuments } from "./SupportingDocuments";

/**
 * SCRUM-51/AC4: the supporting documents on an event's page. Everyone who can see the request sees the list; only the organiser
 * can add or remove, and only while the request is still a draft (a submitted request is not edited by its organiser).
 */
export function EventSupportingDocuments({ event }: { event: { id: string; status: string; isOrganiser?: boolean } }) {
  return <SupportingDocuments eventId={event.id} readOnly={!(event.status === "draft" && event.isOrganiser)} />;
}
