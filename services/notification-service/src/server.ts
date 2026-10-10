import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4005);
createApp().listen(port, () => {
  console.log(`notification-service listening on http://localhost:${port}`);
});
