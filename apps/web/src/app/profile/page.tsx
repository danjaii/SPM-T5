import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { ProfileForm } from "@/components/ProfileForm";
import { getProfile } from "@/lib/profileServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My profile · ConnectSphere" };

// SCRUM-68: a signed-in user views and updates their own profile. SCRUM-122/AC12: reached from the user's name in the sidebar.
export default async function ProfilePage() {
  const result = await getProfile();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">My profile</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Your contact details and the role ConnectSphere has given you.</p>
      {"profile" in result ? <ProfileForm profile={result.profile} /> : <AuthAlert tone="error">{result.error}</AuthAlert>}
    </main>
  );
}
