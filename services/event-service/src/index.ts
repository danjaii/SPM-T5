// Entry point for the event-service. Replace with real bootstrap (Express/Fastify app).
export function healthCheck(): { status: "ok"; service: "event-service" } {
  return { status: "ok", service: "event-service" };
}
