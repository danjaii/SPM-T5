import type { ReactNode } from "react";
import { AuthLayout } from "@/components/AuthLayout";

export default function AuthGroupLayout({ children }: { children: ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}
