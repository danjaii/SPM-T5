import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password · ConnectSphere" };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
