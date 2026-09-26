"use client";

import { useState } from "react";
import { postJson } from "@/lib/api";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await postJson("/auth/logout");
    // A full navigation that replaces this history entry: the dashboard is not left behind for "Back",
    // and the client-side router cache is discarded.
    window.location.replace("/login");
  }

  return (
    <button className="btn btn--ghost" type="button" onClick={logout} disabled={busy}>
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
