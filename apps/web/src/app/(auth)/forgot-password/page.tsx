import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password · ConnectSphere" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
