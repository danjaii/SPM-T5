import { BedDouble, CalendarCheck, CalendarDays, ClipboardList, FilePlus2, Home, ListChecks, ShieldCheck, Users, Wrench, type LucideIcon } from "lucide-react";
import type { Role } from "@spm-t5/shared";

/** The queues whose size is shown beside a nav item (SCRUM-121/AC2). */
export type QueueKey = "leadQueue" | "bookingQueue" | "equipmentQueue" | "safetyQueue";
export type QueueCounts = Partial<Record<QueueKey, number>>;

export interface NavEntry {
  label: string;
  href: string;
  icon: LucideIcon;
  queue?: QueueKey;
}

const dashboard = (role: Role): NavEntry => ({ label: "Home", href: `/dashboard/${role}`, icon: Home });

// SCRUM-121/AC1: each role sees only its own items. Every href is an existing route; routes a role may not open are never listed.
export const NAV_ITEMS: Record<Role, NavEntry[]> = {
  event_organiser: [
    dashboard("event_organiser"),
    { label: "New event request", href: "/events/new", icon: FilePlus2 },
    // SCRUM-52/AC1: every request the organiser created, with its status
    { label: "My event requests", href: "/my-event-requests", icon: ListChecks },
    { label: "Event registrations", href: "/registrations-overview", icon: ClipboardList },
  ],
  event_coordinator: [
    dashboard("event_coordinator"),
    { label: "Event requests", href: "/events/review", icon: ClipboardList },
    { label: "My venue bookings", href: "/venue-bookings", icon: CalendarCheck },
    { label: "Venue catalogue", href: "/venues", icon: BedDouble },
    { label: "Event registrations", href: "/registrations-overview", icon: Users },
  ],
  event_coordinator_lead: [
    dashboard("event_coordinator_lead"),
    { label: "Unassigned requests", href: "/lead/queue", icon: ClipboardList, queue: "leadQueue" },
    { label: "Coordinator overview", href: "/lead/coordinators", icon: Users },
  ],
  venue_staff: [
    dashboard("venue_staff"),
    { label: "Booking requests", href: "/booking-queue", icon: CalendarCheck, queue: "bookingQueue" },
    { label: "Venue catalogue", href: "/venues", icon: BedDouble },
  ],
  technical_support_staff: [
    dashboard("technical_support_staff"),
    { label: "Equipment requests", href: "/equipment-requests", icon: Wrench, queue: "equipmentQueue" },
    { label: "Equipment availability", href: "/equipment-availability", icon: CalendarDays },
    { label: "Reserve equipment", href: "/equipment-reservation", icon: ClipboardList },
  ],
  safety_officer: [
    dashboard("safety_officer"),
    { label: "Safety checks", href: "/safety-checks", icon: ShieldCheck, queue: "safetyQueue" },
  ],
  attendee: [
    dashboard("attendee"),
    { label: "My registrations", href: "/registrations", icon: ClipboardList },
  ],
};

/** The one item that is "current": the longest href the path is on or under, so the most specific item wins. */
export function currentHref(items: NavEntry[], pathname: string): string | undefined {
  const matches = items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
