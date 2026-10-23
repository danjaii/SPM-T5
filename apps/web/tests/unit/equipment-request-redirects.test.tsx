import { describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import EquipmentRequestPage from "@/app/events/[id]/equipment-request/page";
import ChangeEquipmentRequestPage from "@/app/events/[id]/equipment-request/[requestId]/page";

// SCRUM-136/AC1: items are added and changed in a row on the event's Equipment tab, so the old request and change pages
// send an older link there.
describe("SCRUM-136/AC1 the old equipment request pages open the Equipment tab", () => {
  it("the request page (/events/[id]/equipment-request)", async () => {
    await expect(EquipmentRequestPage({ params: Promise.resolve({ id: "evt 1" }) })).rejects.toThrow(
      "redirect:/events/evt%201?tab=equipment",
    );
  });

  it("the change page (/events/[id]/equipment-request/[requestId])", async () => {
    await expect(ChangeEquipmentRequestPage({ params: Promise.resolve({ id: "evt-1", requestId: "req-1" }) })).rejects.toThrow(
      "redirect:/events/evt-1?tab=equipment",
    );
  });
});
