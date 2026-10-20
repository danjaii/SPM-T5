import { redirect } from "next/navigation";
import { getShellData } from "@/lib/shellServer";

// Rendered per request: where "/" leads depends on who is signed in.
export const dynamic = "force-dynamic";

/** SCRUM-122/AC1: a signed-in user lands on their role's home page, anyone else on the sign-in page. */
export default async function HomePage() {
  const shell = await getShellData();
  redirect(shell ? `/dashboard/${shell.user.role}` : "/login");
}
