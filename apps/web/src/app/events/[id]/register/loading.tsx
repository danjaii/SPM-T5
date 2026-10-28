import { PageFrameSkeleton } from "@/components/PageFrame";

// SCRUM-139/AC11: shown while the registration form loads
export default function Loading() {
  return <PageFrameSkeleton label="Loading the event" />;
}
