// SCRUM-56/AC1: a draft list shown without the app router (no router mounted) still offers Delete, and a delete reloads the page

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteDraftButton } from "@/components/DeleteDraftButton";

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-56/AC1 Delete without a mounted router", () => {
  it("renders the button and reloads the page after a confirmed delete", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => undefined }));
    render(<DeleteDraftButton id="d1" name="Half-planned" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft Half-planned" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});
