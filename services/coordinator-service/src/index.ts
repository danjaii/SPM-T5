// Entry point for the coordinator-service. Replace with real bootstrap (Express/Fastify app).
export function healthCheck(): { status: "ok"; service: "coordinator-service" } {
  return { status: "ok", service: "coordinator-service" };
}
