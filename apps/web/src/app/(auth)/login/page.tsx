import type { Metadata } from "next";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = { title: "Sign in · ConnectSphere" };

// SCRUM-83/AC2: ?next= is where the route guard was taking the guest (e.g. a registration form)
// SCRUM-14/AC6: ?reset=success is where the reset form sends the user after saving a new password
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; reset?: string | string[] }> }) {
  const { next, reset } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} passwordReset={reset === "success"} />;
}
