import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ProfileForm } from "@/components/ProfileForm";
import { getProfile } from "@/lib/profileServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My profile · ConnectSphere" };

// SCRUM-68: a signed-in user views and updates their own profile.
export default async function ProfilePage() {
  const result = await getProfile();

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>My profile</h1>
        {"profile" in result ? (
          <ProfileForm profile={result.profile} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
