import { expect, test } from "bun:test";
import { startLocalIntelligence } from "../src/openduet/local-intelligence";

const key = "local-test-key";

function socketUrl(base: string, path: string, params: Record<string, string>) {
  const url = new URL(`${base.replace(/^ws/, "http")}${path}`);
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value);
  url.protocol = base.startsWith("wss") ? "wss:" : "ws:";
  return url.toString();
}

test("a local thread accepts a run and plays it to the browser socket", async () => {
  const service = startLocalIntelligence({ apiKey: key, port: 0 });
  try {
    const denied = await fetch(`${service.apiUrl}/api/threads`, {
      method: "POST",
    });
    expect(denied.status).toBe(401);

    const headers = {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    };
    const missing = await fetch(
      `${service.apiUrl}/api/threads/thread-1?userId=viren`,
      { headers },
    );
    expect(missing.status).toBe(404);

    const created = await fetch(`${service.apiUrl}/api/threads`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        threadId: "thread-1",
        userId: "viren",
        agentId: "openduet",
      }),
    });
    expect(created.status).toBe(200);
    const thread = (await created.json()) as { thread: { id: string } };
    expect(thread.thread.id).toBe("thread-1");

    const locked = await fetch(`${service.apiUrl}/api/threads/thread-1/lock`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        runId: "run-1",
        userId: "viren",
        agentId: "openduet",
        ttlSeconds: 30,
      }),
    });
    expect(locked.status).toBe(200);
    const lock = (await locked.json()) as { joinToken: string; runId: string };
    expect(lock.runId).toBe("run-1");
    expect(lock.joinToken.length).toBeGreaterThan(8);

    const runnerFrames: unknown[][] = [];
    const runner = new WebSocket(
      socketUrl(service.wsUrl, "/runner/websocket", { vsn: "2.0.0" }),
      ["phoenix", `base64url.bearer.phx.${btoa(key).replace(/=/g, "")}`],
    );
    await new Promise<void>((resolve, reject) => {
      runner.onopen = () => resolve();
      runner.onerror = () => reject(new Error("runner socket failed"));
    });
    runner.onmessage = (event) => {
      runnerFrames.push(JSON.parse(String(event.data)) as unknown[]);
    };
    runner.send(
      JSON.stringify([
        "1",
        "1",
        "ingestion:run-1",
        "phx_join",
        { thread_id: "thread-1", run_id: "run-1" },
      ]),
    );
    await waitFor(() =>
      runnerFrames.some(
        (frame) =>
          frame[3] === "phx_reply" &&
          JSON.stringify(frame[4]).includes("runner_event_batch_v1"),
      ),
    );

    const textEvent = {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m1",
      delta: "Start with calc.",
      threadId: "thread-1",
      runId: "run-1",
      metadata: { cpki_event_id: "evt-1", cpki_event_seq: 1 },
    };
    runner.send(
      JSON.stringify([
        "1",
        "2",
        "ingestion:run-1",
        "events",
        { events: [textEvent] },
      ]),
    );
    await waitFor(() =>
      runnerFrames.some(
        (frame) => frame[1] === "2" && frame[3] === "phx_reply",
      ),
    );

    const clientFrames: unknown[][] = [];
    const client = new WebSocket(
      socketUrl(service.wsUrl, "/client/websocket", {
        join_token: lock.joinToken,
        vsn: "2.0.0",
      }),
    );
    await new Promise<void>((resolve, reject) => {
      client.onopen = () => resolve();
      client.onerror = () => reject(new Error("client socket failed"));
    });
    client.onmessage = (event) => {
      clientFrames.push(JSON.parse(String(event.data)) as unknown[]);
    };
    client.send(
      JSON.stringify([
        "2",
        "1",
        "thread:thread-1",
        "phx_join",
        { stream_mode: "run", run_id: "run-1" },
      ]),
    );
    await waitFor(() =>
      clientFrames.some(
        (frame) =>
          frame[3] === "ag_ui_event" &&
          JSON.stringify(frame[4]).includes("Start with calc."),
      ),
    );

    const history = await fetch(
      `${service.apiUrl}/api/threads/thread-1/messages?userId=viren`,
      { headers },
    );
    expect(history.status).toBe(200);
    runner.close();
    client.close();
  } finally {
    service.stop();
  }
});

async function waitFor(ready: () => boolean) {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 3000) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
