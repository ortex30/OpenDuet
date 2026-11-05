import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadTenantPackage } from "../src/tenant-package";

/*
 * Academic OS's learning skills ship in the tenant package (examples/openduet/skills.yaml). These
 * checks hold the parts of each instruction the product depends on: every practice skill saves to
 * study memory, every skill that touches an assignment follows the teacher's AI help level, and
 * none of them hands over finished work.
 */

const LEARNING_SKILLS = [
  "review",
  "my-mistakes",
  "tutor",
  "teach-back",
  "check-my-work",
  "writing-feedback",
  "study-guide",
  "reading-check",
] as const;

const tenant = await loadTenantPackage(
  join(import.meta.dir, "../../examples/openduet"),
);
const skill = (slug: string) => {
  const found = tenant.skills.find((candidate) => candidate.slug === slug);
  if (!found) throw new Error(`skill ${slug} is not in the package`);
  return found;
};

test("the package loads with every learning skill on Academic OS's own Bot", () => {
  const bot = tenant.agents.find((agent) => agent.id === tenant.tenantId);
  expect(bot?.name).toBe("Academic OS");
  for (const slug of LEARNING_SKILLS) {
    expect(bot?.skills).toContain(slug);
    expect(skill(slug).title.length).toBeGreaterThan(0);
    expect(skill(slug).summary.length).toBeLessThanOrEqual(120);
  }
});

test("the Bot's prompt tells it to save practice to study memory", () => {
  const bot = tenant.agents.find((agent) => agent.id === tenant.tenantId);
  const prompt = (bot?.configuration as { systemPrompt?: string }).systemPrompt;
  expect(prompt).toContain("record_study");
  expect(prompt).toContain("study_memory");
});

test("every practice skill saves how it went", () => {
  for (const slug of LEARNING_SKILLS.filter((slug) => slug !== "study-guide"))
    expect(skill(slug).instructions).toContain("record_study");
});

test("review, mistakes and the study guide read study memory first", () => {
  expect(skill("review").instructions).toContain(
    'study_memory with view "due"',
  );
  expect(skill("my-mistakes").instructions).toContain(
    'study_memory with view "mistakes"',
  );
  expect(skill("study-guide").instructions).toContain(
    'study_memory with view "subject"',
  );
});

test("skills that touch an assignment follow the teacher's No help rule", () => {
  for (const slug of [
    "tutor",
    "teach-back",
    "check-my-work",
    "writing-feedback",
    "study-guide",
    "reading-check",
  ])
    expect(skill(slug).instructions).toContain("No help");
});

test("checking and feedback never hand over the fix", () => {
  expect(skill("check-my-work").instructions).toContain(
    "Never write the corrected step or the final answer",
  );
  expect(skill("writing-feedback").instructions).toContain(
    "never write, rewrite or suggest wording",
  );
  expect(skill("tutor").instructions).toContain(
    "never solve any\n      step of their problem".replace(/\n\s+/, " "),
  );
});

test("page-making skills use make_page block kinds the page tool accepts", () => {
  expect(skill("writing-feedback").instructions).toContain("make_page");
  expect(skill("writing-feedback").instructions).toContain("table");
  expect(skill("writing-feedback").instructions).toContain("checklist");
  expect(skill("study-guide").instructions).toContain("make_page");
});
