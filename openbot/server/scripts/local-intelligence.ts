/**
 * Starts the local thread service Academic OS uses when no CopilotKit
 * Intelligence project is configured. The dev script points
 * INTELLIGENCE_API_URL at it and writes a local- key.
 */
import { startLocalIntelligence } from "../src/openduet/local-intelligence";

const apiKey = process.env.INTELLIGENCE_API_KEY?.trim() ?? "";
if (!apiKey.startsWith("local-")) {
  console.log(
    "Local intelligence stays off. The intelligence key is not a local- key.",
  );
  process.exit(0);
}

const port = Number(process.env.LOCAL_INTELLIGENCE_PORT ?? 7091);
const persistPath = process.env.LOCAL_INTELLIGENCE_STORE?.trim();
const running = startLocalIntelligence({
  apiKey,
  port,
  ...(persistPath ? { persistPath } : {}),
});
console.log(`Local intelligence is at ${running.apiUrl}`);

const shutdown = () => {
  running.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
