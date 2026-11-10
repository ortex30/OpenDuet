import { studyModels } from "../model-env";

/**
 * One JSON completion. A missing key, a bad status, or a bad body returns null
 * so the notes draft can stand. The key is never written to a log.
 */
export async function completeJson(options: {
  env: Record<string, string | undefined>;
  system: string;
  user: string;
  fetchImpl?: typeof fetch;
  /** Guide model by default. Pass "fast" for a short check. */
  which?: "guide" | "fast";
  maxTokens?: number;
}): Promise<unknown | null> {
  const key = options.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = studyModels(options.env)[options.which ?? "guide"];
  try {
    const response = await fetchImpl(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(70_000),
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: options.maxTokens ?? 4000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: options.system },
            { role: "user", content: options.user },
          ],
        }),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return parseJson(body.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

export function parseJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/** Content words shared by two strings. Short words and math markers are skipped. */
export function sharedWords(left: string, right: string): number {
  const hay = right.toLowerCase();
  const words = contentWords(left);
  return words.filter((word) => hay.includes(word)).length;
}

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\$[^$]*\$/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5);
}
