import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // SCRUM-195/AC8: test requests go to [::1], so another program on the same port number cannot answer them
    setupFiles: ["./tests/setup/ipv6Loopback.ts"],
  },
});
