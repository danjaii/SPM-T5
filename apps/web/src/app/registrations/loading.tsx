import { PageFrameSkeleton } from "@/components/PageFrame";

// SCRUM-139/AC11: shown while My registrations loads
export default function Loading() {
  return <PageFrameSkeleton label="Loading your registrations" />;
}
