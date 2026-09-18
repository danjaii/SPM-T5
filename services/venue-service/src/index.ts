// Entry point for the venue-service. Replace with real bootstrap (Express/Fastify app).
export function healthCheck(): { status: "ok"; service: "venue-service" } {
  return { status: "ok", service: "venue-service" };
}
