// Entry point for the auth-service. Replace with real bootstrap (Express/Fastify app).
export function healthCheck(): { status: "ok"; service: "auth-service" } {
  return { status: "ok", service: "auth-service" };
}
