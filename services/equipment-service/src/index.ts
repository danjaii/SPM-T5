// Entry point for the equipment-service. Replace with real bootstrap (Express/Fastify app).
export function healthCheck(): { status: "ok"; service: "equipment-service" } {
  return { status: "ok", service: "equipment-service" };
}
