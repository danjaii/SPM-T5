import { PageFrameSkeleton } from "@/components/PageFrame";

// SCRUM-124/AC10: the shape of the Drafts page while it loads.
export default function Loading() {
  return <PageFrameSkeleton label="Loading your drafts" />;
}
