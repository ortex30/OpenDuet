import { expect, test } from "bun:test";
import {
  applyChatModelEnv,
  OPENROUTER_BASE_URL,
} from "../src/openduet/model-env";

test("an OpenAI key is left alone", () => {
  const env = { OPENAI_API_KEY: "sk-openai", OPENROUTER_API_KEY: "sk-or" };
  applyChatModelEnv(env);
  expect(env.OPENAI_API_KEY).toBe("sk-openai");
  expect(env.OPENAI_BASE_URL).toBeUndefined();
});

test("OpenRouter is used when it is the only key", () => {
  const env: Record<string, string | undefined> = {
    OPENROUTER_API_KEY: "sk-or",
    OPENROUTER_MODEL: "openai/gpt-4.1-mini",
  };
  applyChatModelEnv(env);
  expect(env.OPENAI_API_KEY).toBe("sk-or");
  expect(env.OPENAI_BASE_URL).toBe(OPENROUTER_BASE_URL);
  expect(env.ACADEMIC_OS_MODEL).toBe("openai/gpt-4.1-mini");
  expect(env.BOT_PROVIDER).toBe("openai");
  expect(env.BOT_MODEL).toBe("openai/gpt-4.1-mini");
});

test("naming openrouter wins over an OpenAI key's endpoint, and keeps the OpenAI key", () => {
  const env: Record<string, string | undefined> = {
    ACADEMIC_OS_PROVIDER: "openrouter",
    OPENAI_API_KEY: "sk-openai",
    OPENROUTER_API_KEY: "sk-or",
  };
  applyChatModelEnv(env);
  expect(env.OPENAI_API_KEY).toBe("sk-openai");
  expect(env.OPENAI_BASE_URL).toBe(OPENROUTER_BASE_URL);
  expect(env.BOT_PROVIDER).toBe("openai");
});
