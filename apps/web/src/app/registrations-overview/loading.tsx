import { PageFrameSkeleton } from "@/components/PageFrame";

// SCRUM-139/AC11: shown while the registrations overview loads
export default function Loading() {
  return <PageFrameSkeleton label="Loading registrations" />;
}
