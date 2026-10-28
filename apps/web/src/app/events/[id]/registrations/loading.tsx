import { PageFrameSkeleton } from "@/components/PageFrame";

// SCRUM-139/AC11: shown while an event's registrations load
export default function Loading() {
  return <PageFrameSkeleton label="Loading registrations" />;
}
