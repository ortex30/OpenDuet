/**
 * Which model Academic OS calls, from the environment.
 *
 * OPENAI_API_KEY is the primary provider. The tenant package's model.yaml
 * reads ACADEMIC_OS_MODEL when it is set, and gpt-5.6-terra when it is not.
 *
 * OpenRouter stays available as an OpenAI-compatible endpoint. Set
 * ACADEMIC_OS_PROVIDER=openrouter, or set OPENROUTER_API_KEY with no
 * OPENAI_API_KEY. An OPENAI_API_KEY wins unless openrouter is named.
 */

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function applyChatModelEnv(
  env: Record<string, string | undefined>,
): void {
  const named = (env.ACADEMIC_OS_PROVIDER ?? "").trim().toLowerCase();
  const openAI = env.OPENAI_API_KEY?.trim() ?? "";
  const openRouter = env.OPENROUTER_API_KEY?.trim() ?? "";
  const wantOpenRouter =
    named === "openrouter" ||
    (named !== "openai" &&
      named !== "anthropic" &&
      !openAI &&
      openRouter.length > 0);
  if (!wantOpenRouter) return;

  if (!env.OPENAI_BASE_URL?.trim()) env.OPENAI_BASE_URL = OPENROUTER_BASE_URL;
  if (!openAI && openRouter) env.OPENAI_API_KEY = openRouter;
  if (!env.ACADEMIC_OS_MODEL?.trim()) {
    env.ACADEMIC_OS_MODEL =
      env.OPENROUTER_MODEL?.trim() ||
      env.BOT_MODEL?.trim() ||
      "openai/gpt-4.1-mini";
  }
  // The built-in Bot uses BOT_MODEL only when an OpenAI-compatible base URL is set.
  if (!env.BOT_MODEL?.trim()) env.BOT_MODEL = env.ACADEMIC_OS_MODEL;
  if (!env.BOT_PROVIDER?.trim() || named === "openrouter") {
    env.BOT_PROVIDER = "openai";
  }
}
