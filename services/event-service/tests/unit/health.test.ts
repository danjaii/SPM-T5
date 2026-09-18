import { describe, it, expect } from "vitest";
import { healthCheck } from "../../src/index";

describe("event-service health check", () => {
  it("reports ok status", () => {
    expect(healthCheck()).toEqual({ status: "ok", service: "event-service" });
  });
});
