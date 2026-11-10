/**
 * A local stand-in for the CopilotKit Intelligence calls Academic OS chat
 * actually makes: thread records, the run lock, and the Phoenix sockets the
 * runtime and the browser use to pass a turn.
 *
 * It is not a CopilotKit Intelligence deployment. It keeps threads in memory
 * for this process, checks the local key the dev script writes, and speaks
 * only the slice of the protocol a conversation needs.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BATCH = "runner_event_batch_v1";
const AUTH_PREFIX = "base64url.bearer.phx.";

type Message = {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: { id: string; name: string; args: string }[];
  toolCallId?: string;
};

type AgEvent = Record<string, unknown> & { type?: string };

type Thread = {
  id: string;
  userId: string;
  agentId: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messages: Message[];
  events: AgEvent[];
  lock: { runId: string; expiresAt: number } | null;
  joinToken: string;
};

type Sock = { kind: "runner" | "client" };

type ClientConn = {
  ws: Bun.ServerWebSocket<Sock>;
  threadId: string;
  sent: Set<string>;
};

export type LocalIntelligence = {
  port: number;
  apiUrl: string;
  wsUrl: string;
  apiKey: string;
  stop: () => void;
};

export function startLocalIntelligence(options: {
  apiKey: string;
  port?: number;
  hostname?: string;
  /** A JSON file of threads. Absent keeps them in memory for this process only. */
  persistPath?: string;
}): LocalIntelligence {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("A local intelligence key is required.");
  const hostname = options.hostname ?? "127.0.0.1";
  const threads = new Map<string, Thread>();
  const clients = new Set<ClientConn>();
  const persistPath = options.persistPath?.trim() || "";
  loadThreads(persistPath, threads);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveThreads(persistPath, threads);
  };
  const scheduleSave = () => {
    if (!persistPath) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 200);
  };
  const partials = new Map<
    string,
    { id: string; role: string; text: string }
  >();

  const summary = (thread: Thread) => ({
    id: thread.id,
    name: thread.name,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archived: thread.archived,
    agentId: thread.agentId,
    createdById: thread.userId,
  });

  const threadOrNull = (id: string) => threads.get(id) ?? null;

  const ensure = (id: string, userId: string, agentId: string) => {
    const found = threads.get(id);
    if (found) return found;
    const now = new Date().toISOString();
    const created: Thread = {
      id,
      userId,
      agentId,
      name: null,
      createdAt: now,
      updatedAt: now,
      archived: false,
      messages: [],
      events: [],
      lock: null,
      joinToken: randomUUID(),
    };
    threads.set(id, created);
    scheduleSave();
    return created;
  };

  const eventId = (event: AgEvent) => {
    const metadata = event.metadata;
    if (!metadata || typeof metadata !== "object") return "";
    const id = (metadata as { cpki_event_id?: unknown }).cpki_event_id;
    return typeof id === "string" ? id : "";
  };

  const rememberEvent = (thread: Thread, event: AgEvent) => {
    const id = eventId(event);
    if (id && thread.events.some((item) => eventId(item) === id)) return;
    thread.events.push(event);
    if (thread.events.length > 500)
      thread.events.splice(0, thread.events.length - 500);
    thread.updatedAt = new Date().toISOString();
    absorb(thread, event);
    scheduleSave();
  };

  const absorb = (thread: Thread, event: AgEvent) => {
    if (event.type === "RUN_STARTED") {
      const input = event.input;
      const messages =
        input && typeof input === "object"
          ? (input as { messages?: unknown }).messages
          : undefined;
      if (!Array.isArray(messages)) return;
      for (const item of messages) {
        if (!item || typeof item !== "object") continue;
        const message = item as Message;
        if (typeof message.id !== "string" || typeof message.role !== "string")
          continue;
        if (thread.messages.some((saved) => saved.id === message.id)) continue;
        thread.messages.push({
          id: message.id,
          role: message.role,
          ...(message.content !== undefined
            ? { content: message.content }
            : {}),
          ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
          ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        });
      }
      return;
    }
    const messageId =
      typeof event.messageId === "string" ? event.messageId : "";
    if (!messageId) return;
    if (event.type === "TEXT_MESSAGE_START") {
      partials.set(messageId, {
        id: messageId,
        role: typeof event.role === "string" ? event.role : "assistant",
        text: "",
      });
    } else if (event.type === "TEXT_MESSAGE_CONTENT") {
      const partial = partials.get(messageId);
      if (partial && typeof event.delta === "string")
        partial.text += event.delta;
    } else if (event.type === "TEXT_MESSAGE_END") {
      const partial = partials.get(messageId);
      partials.delete(messageId);
      if (!partial || thread.messages.some((item) => item.id === partial.id))
        return;
      thread.messages.push({
        id: partial.id,
        role: partial.role,
        content: partial.text,
      });
    }
  };

  const send = (
    ws: Bun.ServerWebSocket<Sock>,
    joinRef: unknown,
    ref: unknown,
    topic: string,
    event: string,
    payload: unknown,
  ) => {
    ws.send(JSON.stringify([joinRef, ref, topic, event, payload]));
  };

  const reply = (
    ws: Bun.ServerWebSocket<Sock>,
    joinRef: unknown,
    ref: unknown,
    topic: string,
    response: unknown,
  ) => {
    send(ws, joinRef, ref, topic, "phx_reply", {
      status: "ok",
      response,
    });
  };

  const broadcast = (thread: Thread, event: AgEvent) => {
    const id = eventId(event);
    const topic = `thread:${thread.id}`;
    for (const client of clients) {
      if (client.threadId !== thread.id) continue;
      if (id && client.sent.has(id)) continue;
      if (id) client.sent.add(id);
      send(client.ws, null, null, topic, "ag_ui_event", event);
    }
  };

  const replay = (client: ClientConn, params: Record<string, unknown>) => {
    const thread = threads.get(client.threadId);
    if (!thread) return;
    const mode = params.stream_mode === "connect" ? "connect" : "run";
    const runId = typeof params.run_id === "string" ? params.run_id : "";
    const after =
      typeof params.last_seen_event_id === "string"
        ? params.last_seen_event_id
        : "";
    let started = after === "";
    const topic = `thread:${thread.id}`;
    for (const event of thread.events) {
      const id = eventId(event);
      if (!started) {
        if (id === after) started = true;
        continue;
      }
      if (
        mode === "run" &&
        runId &&
        event.runId !== runId &&
        event.run_id !== runId
      )
        continue;
      if (id && client.sent.has(id)) continue;
      if (id) client.sent.add(id);
      send(client.ws, null, null, topic, "ag_ui_event", event);
    }
    const latest =
      [...thread.events].reverse().map(eventId).find(Boolean) ?? null;
    send(client.ws, null, null, topic, "replay_complete", {
      latestEventId: latest,
    });
    const live = thread.lock && thread.lock.expiresAt > Date.now();
    if (!live) {
      send(client.ws, null, null, topic, "stream_idle", {
        latestEventId: latest,
      });
    }
  };

  const takeEvents = (payload: unknown): AgEvent[] => {
    if (!payload || typeof payload !== "object") return [];
    const body = payload as { events?: unknown };
    if (Array.isArray(body.events))
      return body.events.filter(
        (item): item is AgEvent => !!item && typeof item === "object",
      );
    return [payload as AgEvent];
  };

  const onSocketMessage = (ws: Bun.ServerWebSocket<Sock>, raw: string) => {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(frame) || frame.length < 5) return;
    const [joinRef, ref, topic, event, payload] = frame;
    if (typeof topic !== "string" || typeof event !== "string") return;
    const body =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    if (event === "heartbeat") {
      reply(ws, joinRef, ref, topic, {});
      return;
    }
    if (event === "phx_leave") {
      reply(ws, joinRef, ref, topic, {});
      return;
    }
    if (event === "phx_join" && topic.startsWith("ingestion:")) {
      const threadId = typeof body.thread_id === "string" ? body.thread_id : "";
      if (threadId) ensure(threadId, "local", "openduet");
      reply(ws, joinRef, ref, topic, { capabilities: [BATCH] });
      return;
    }
    if (event === "phx_join" && topic.startsWith("thread:")) {
      const threadId = topic.slice("thread:".length);
      const client: ClientConn = { ws, threadId, sent: new Set() };
      clients.add(client);
      reply(ws, joinRef, ref, topic, {});
      replay(client, body);
      return;
    }
    if (
      (event === "events" || event === "event") &&
      topic.startsWith("ingestion:")
    ) {
      const runId = topic.slice("ingestion:".length);
      for (const item of takeEvents(body)) {
        const threadId =
          typeof item.threadId === "string"
            ? item.threadId
            : typeof item.thread_id === "string"
              ? item.thread_id
              : "";
        if (!threadId) continue;
        const thread = ensure(threadId, "local", "openduet");
        if (!item.runId) item.runId = runId;
        rememberEvent(thread, item);
        broadcast(thread, item);
      }
      reply(ws, joinRef, ref, topic, {});
      return;
    }
    if (ref != null) reply(ws, joinRef, ref, topic, {});
  };

  const authorized = (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    return header === `Bearer ${apiKey}`;
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const readJson = async (request: Request) =>
    (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const server = Bun.serve<Sock>({
    hostname,
    port: options.port ?? 0,
    fetch: async (request, bun) => {
      const url = new URL(request.url);
      if (
        url.pathname === "/runner/websocket" ||
        url.pathname === "/client/websocket"
      ) {
        if (url.pathname === "/runner/websocket") {
          const token = protocolToken(request);
          if (token !== apiKey)
            return new Response("Unauthorized", { status: 401 });
        } else {
          const token = url.searchParams.get("join_token");
          const known = [...threads.values()].some(
            (thread) => thread.joinToken === token,
          );
          if (!known) return new Response("Unauthorized", { status: 401 });
        }
        const kind = url.pathname.startsWith("/runner") ? "runner" : "client";
        const upgraded = bun.upgrade(request, {
          data: { kind },
          ...(kind === "runner"
            ? { headers: { "Sec-WebSocket-Protocol": "phoenix" } }
            : {}),
        });
        if (upgraded) return undefined;
        return new Response("Upgrade failed", { status: 400 });
      }

      if (url.pathname === "/health") return json({ ok: true });
      if (!authorized(request)) return json({ error: "Unauthorized" }, 401);

      if (
        request.method === "GET" &&
        url.pathname === "/api/entitlements/runtime"
      ) {
        return json({
          status: "ready",
          entitlement: {
            active: true,
            source: "selfHostedDeploymentLicense",
            features: { memory: false },
            limits: {},
            planCode: "developer",
          },
        });
      }
      if (
        request.method === "GET" &&
        url.pathname === "/api/inspector/metadata"
      ) {
        return new Response(null, { status: 404 });
      }
      if (request.method === "GET" && url.pathname === "/api/threads") {
        const userId = url.searchParams.get("userId") ?? "";
        const agentId = url.searchParams.get("agentId") ?? "";
        const list = [...threads.values()].filter(
          (thread) =>
            thread.userId === userId &&
            thread.agentId === agentId &&
            !thread.archived,
        );
        return json({
          threads: list.map(summary),
          joinCode: "local",
          joinToken: randomUUID(),
          nextCursor: null,
        });
      }
      if (request.method === "POST" && url.pathname === "/api/threads") {
        const body = await readJson(request);
        const threadId =
          typeof body?.threadId === "string" ? body.threadId : "";
        const userId = typeof body?.userId === "string" ? body.userId : "";
        const agentId = typeof body?.agentId === "string" ? body.agentId : "";
        if (!threadId || !userId || !agentId)
          return json({ error: "Missing thread fields." }, 400);
        if (threads.has(threadId)) return json({ error: "Exists" }, 409);
        const thread = ensure(threadId, userId, agentId);
        if (typeof body?.name === "string") thread.name = body.name;
        return json({ thread: summary(thread) });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/threads/subscribe"
      ) {
        return json({ joinToken: randomUUID() });
      }

      const threadMatch = /^\/api\/threads\/([^/]+)(.*)$/.exec(url.pathname);
      if (!threadMatch) return json({ error: "Not found" }, 404);
      const threadId = decodeURIComponent(threadMatch[1] ?? "");
      const rest = threadMatch[2] ?? "";
      const thread = threadOrNull(threadId);

      if (request.method === "GET" && rest === "") {
        if (!thread) return json({ error: "Not found" }, 404);
        return json({ thread: summary(thread) });
      }
      if (request.method === "PATCH" && rest === "") {
        if (!thread) return json({ error: "Not found" }, 404);
        const body = await readJson(request);
        if (typeof body?.name === "string") thread.name = body.name;
        if (body?.archived === true) thread.archived = true;
        thread.updatedAt = new Date().toISOString();
        scheduleSave();
        return json({ thread: summary(thread) });
      }
      if (request.method === "DELETE" && rest === "") {
        if (thread) threads.delete(threadId);
        scheduleSave();
        return new Response(null, { status: 204 });
      }
      if (request.method === "GET" && rest === "/messages") {
        if (!thread) return json({ messages: [] });
        return json({ messages: thread.messages });
      }
      if (request.method === "POST" && rest === "/lock") {
        if (!thread) return json({ error: "Not found" }, 404);
        const body = await readJson(request);
        const runId = typeof body?.runId === "string" ? body.runId : "";
        if (!runId) return json({ error: "Missing run." }, 400);
        const ttl = typeof body?.ttlSeconds === "number" ? body.ttlSeconds : 60;
        const now = Date.now();
        if (
          thread.lock &&
          thread.lock.runId !== runId &&
          thread.lock.expiresAt > now
        ) {
          return json({ error: "Thread lock denied" }, 409);
        }
        thread.lock = { runId, expiresAt: now + ttl * 1000 };
        return json({
          threadId: thread.id,
          runId,
          joinToken: thread.joinToken,
          backendThreadId: thread.id,
          lock: { key: `local:${thread.id}`, ttlSeconds: ttl },
        });
      }
      if (request.method === "PATCH" && rest === "/lock") {
        if (!thread?.lock) return json({ error: "Not found" }, 404);
        const body = await readJson(request);
        const ttl = typeof body?.ttlSeconds === "number" ? body.ttlSeconds : 60;
        if (body?.runId && body.runId !== thread.lock.runId)
          return json({ error: "Thread lock denied" }, 409);
        thread.lock.expiresAt = Date.now() + ttl * 1000;
        return json({ ttlSeconds: ttl });
      }
      if (request.method === "DELETE" && rest === "/lock") {
        const body = await readJson(request);
        if (thread?.lock && (!body?.runId || body.runId === thread.lock.runId))
          thread.lock = null;
        return new Response(null, { status: 204 });
      }
      if (request.method === "GET" && rest === "/join-code") {
        if (!thread) return json({ error: "Not found" }, 404);
        return json({ joinToken: thread.joinToken, joinCode: thread.id });
      }
      if (request.method === "POST" && rest === "/connect") {
        if (!thread) return json({ error: "Not found" }, 404);
        return json({
          threadId: thread.id,
          joinToken: thread.joinToken,
          ...(thread.lock ? { runId: thread.lock.runId } : {}),
        });
      }
      if (request.method === "GET" && rest === "/events") {
        return json({
          events: thread?.events ?? [],
          decodeErrorRowIds: [],
          truncated: false,
        });
      }
      if (request.method === "GET" && rest === "/state") {
        return json({ kind: "no-snapshot" });
      }
      return json({ error: "Not found" }, 404);
    },
    websocket: {
      open() {},
      message(ws, message) {
        const text =
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message);
        onSocketMessage(ws, text);
      },
      close(ws) {
        for (const client of clients)
          if (client.ws === ws) clients.delete(client);
      },
    },
  });

  return {
    port: server.port ?? 0,
    apiUrl: `http://${hostname}:${server.port}`,
    wsUrl: `ws://${hostname}:${server.port}`,
    apiKey,
    stop: () => {
      flush();
      server.stop(true);
    },
  };
}

function loadThreads(path: string, threads: Map<string, Thread>) {
  if (!path) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      version?: number;
      threads?: Thread[];
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.threads)) return;
    for (const row of parsed.threads) {
      if (!row || typeof row.id !== "string") continue;
      threads.set(row.id, {
        ...row,
        messages: Array.isArray(row.messages) ? row.messages.slice(-300) : [],
        events: Array.isArray(row.events) ? row.events.slice(-500) : [],
        lock: null,
      });
    }
  } catch {
    // A missing file is a new install. A bad file is ignored rather than crashing chat.
  }
}

function saveThreads(path: string, threads: Map<string, Thread>) {
  if (!path) return;
  const body = JSON.stringify({
    version: 1,
    threads: [...threads.values()].map((thread) => ({
      ...thread,
      messages: thread.messages.slice(-300),
      events: thread.events.slice(-500),
      lock: null,
    })),
  });
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, body);
  renameSync(temporary, path);
}

function protocolToken(request: Request): string | null {
  const header = request.headers.get("sec-websocket-protocol") ?? "";
  for (const part of header.split(",")) {
    const value = part.trim();
    if (!value.startsWith(AUTH_PREFIX)) continue;
    const raw = value.slice(AUTH_PREFIX.length);
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    try {
      return Buffer.from(padded, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  return null;
}
