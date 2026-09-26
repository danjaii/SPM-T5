import type { Metadata } from "next";
import { RegisterForm } from "@/components/RegisterForm";

export const metadata: Metadata = { title: "Create account · ConnectSphere" };

export default function RegisterPage() {
  return <RegisterForm />;
}
