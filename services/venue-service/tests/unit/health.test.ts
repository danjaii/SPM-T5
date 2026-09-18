import { describe, it, expect } from "vitest";
import { healthCheck } from "../../src/index";

describe("venue-service health check", () => {
  it("reports ok status", () => {
    expect(healthCheck()).toEqual({ status: "ok", service: "venue-service" });
  });
});
