import { redirect } from "next/navigation";

// SCRUM-131: the venue search moved into the venue catalogue; this keeps old links and bookmarks working.
export default function VenueSearchPage() {
  redirect("/venues");
}
