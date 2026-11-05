import { createDatabase } from "../src/db/client";
import { createStudy } from "../src/openduet/wiring";
import { quizTools } from "../src/openduet/study/quiz-tools";
import { planTools } from "../src/openduet/study/plan-tools";
import { guardTeacherRules } from "../src/openduet/study/guard";
import { callTool as gcall } from "../src/plugins/google-workspace-rest";
const database = createDatabase(process.env.DATABASE_URL!);
const callTool = async (i: any) => gcall({ url: "http://127.0.0.1:4900", token: "fake-access-8sQEAfJoOZi1LiH-HET8u7eVDuKjQKqV" }, i.ref.split("/").pop(), i.args);
const study = createStudy({ database, callTool } as any);
const ctx = { actorId: "dev-local-user", botId: "openduet", initiator: { type: "user", id: "dev-local-user" } as any };
const tools = guardTeacherRules([...quizTools({ ...ctx, ...study, callTool } as any), ...planTools({ ...ctx, ...study, callTool } as any)], { ...ctx, school: study.school, rules: study.rules } as any);
const t = (n: string) => tools.find((x) => x.name === n)!;
const run = async (n: string, a: unknown) => { const r = await t(n).execute(a); console.log(`== ${n}\n${r}`); };
await run("make_quiz", { class: "Precalculus", assignment: "Unit 4 quiz: Trig identities", title: "Trig identities warm-up", questions: [
 { question: "Which is equal to sin²θ + cos²θ?", choices: ["0", "1", "tan²θ", "2sinθcosθ"], answer: 1, explanation: "The Pythagorean identity: sin²θ + cos²θ = 1 for every angle.", topic: "Pythagorean identities" },
 { question: "What is 1 + tan²θ equal to?", choices: ["sec²θ", "csc²θ", "cot²θ", "cos²θ"], answer: 0, explanation: "Divide sin²θ + cos²θ = 1 by cos²θ to get 1 + tan²θ = sec²θ.", topic: "Pythagorean identities" },
 { question: "Which is equal to sin(2θ)?", choices: ["2sinθ", "sin²θ − cos²θ", "2sinθcosθ", "cos²θ − sin²θ"], answer: 2, explanation: "The double-angle identity: sin(2θ) = 2sinθcosθ.", topic: "Double-angle identities" },
 { question: "tanθ is the same as…", choices: ["cosθ / sinθ", "sinθ / cosθ", "1 / sinθ", "1 / cosθ"], answer: 1, explanation: "Tangent is sine over cosine.", topic: "Quotient identities" },
 { question: "Which is equal to cos(−θ)?", choices: ["−cosθ", "cosθ", "sinθ", "−sinθ"], answer: 1, explanation: "Cosine is even, so cos(−θ) = cosθ.", topic: "Even and odd identities" },
]});
process.exit(0);
