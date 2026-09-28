import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import EventReviewActions from "@/components/EventReviewActions";

// ---------------------------------------------------------------------------
// SCRUM-24/AC3 — Confirm decision
// ---------------------------------------------------------------------------
describe("SCRUM-24/AC3 — Confirm decision", () => {
  it("shows a confirmation dialog when the coordinator clicks Approve before firing the action", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<EventReviewActions onApprove={onApprove} onReject={onReject} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    // Dialog must be visible — action must NOT have fired yet
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("shows a confirmation dialog when the coordinator clicks Reject before firing the action", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<EventReviewActions onApprove={onApprove} onReject={onReject} />);

    fireEvent.click(screen.getByRole("button", { name: /reject/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("calls onApprove only after the coordinator confirms the approval dialog", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<EventReviewActions onApprove={onApprove} onReject={onReject} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onApprove).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("does not call onApprove when the coordinator cancels the approval dialog", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<EventReviewActions onApprove={onApprove} onReject={onReject} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls onReject only after the coordinator confirms the rejection dialog", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<EventReviewActions onApprove={onApprove} onReject={onReject} />);

    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onReject).toHaveBeenCalledOnce();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("does not call onReject when the coordinator cancels the rejection dialog", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<EventReviewActions onApprove={onApprove} onReject={onReject} />);

    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onReject).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
