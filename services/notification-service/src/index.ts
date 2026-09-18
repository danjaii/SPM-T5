// Entry point for the notification-service. Replace with real bootstrap (Express/Fastify app).
export function healthCheck(): { status: "ok"; service: "notification-service" } {
  return { status: "ok", service: "notification-service" };
}
