import { PageFrameSkeleton } from "@/components/PageFrame";

// SCRUM-139/AC11: shown while the List of events loads
export default function Loading() {
  return <PageFrameSkeleton label="Loading events" />;
}
