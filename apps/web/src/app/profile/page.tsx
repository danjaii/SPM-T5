import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { ProfileForm } from "@/components/ProfileForm";
import { getProfile } from "@/lib/profileServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My profile · ConnectSphere" };

// SCRUM-68: a signed-in user views and updates their own profile. SCRUM-122/AC12: reached from the user's name in the sidebar.
// SCRUM-186/AC1, AC5: the shared page frame.
export default async function ProfilePage() {
  const result = await getProfile();

  return (
    <PageFrame
      title="My profile"
      description="Your contact details and the role ConnectSphere has given you."
      error={"profile" in result ? undefined : result.error}
    >
      {"profile" in result && <ProfileForm profile={result.profile} />}
    </PageFrame>
  );
}
