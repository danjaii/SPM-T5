import { describe, it, expect } from "vitest";
import { healthCheck } from "../../src/index";

describe("equipment-service health check", () => {
  it("reports ok status", () => {
    expect(healthCheck()).toEqual({ status: "ok", service: "equipment-service" });
  });
});
