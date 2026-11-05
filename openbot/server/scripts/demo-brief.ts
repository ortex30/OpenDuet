import { buildMorningBrief } from "../src/openduet/brief";
import { callTool as gcall } from "../src/plugins/google-workspace-rest";
const token = process.argv[2];
const callTool = async (i: any) => gcall({ url: "http://127.0.0.1:4900", token }, i.ref.split("/").pop(), i.args);
// Stand-in for the model's triage call, which needs a live AI key.
const rules: [RegExp, "needs_you" | "can_wait", string][] = [
  [/Missing: "Section 4\.3/, "needs_you", "Mr. Chen marked it missing; late work still earns 70%."],
  [/Unit 4 quiz/, "needs_you", "Trig identities quiz is tomorrow morning."],
  [/Lab 6 report/, "needs_you", "Lab report due tomorrow night."],
  [/DBQ essay/, "needs_you", "DBQ essay due Monday; no AI help on this one."],
  [/Unidad 5/, "needs_you", "Spanish vocab test next week."],
  [/Gatsby analytical/, "can_wait", "Essay is due next week."],
  [/chem lab group/, "needs_you", "Sam needs your lab data tonight."],
  [/Dentist/, "needs_you", "Mom moved your dentist appointment."],
  [/Practice moved/, "needs_you", "Practice is on Field B today."],
  [/course planning/, "can_wait", "Ms. Patel wants to meet about junior courses."],
];
const complete = async (prompt: string) => {
  for (const [re, verdict, reason] of rules) if (re.test(prompt)) return JSON.stringify({ verdict, reason });
  return JSON.stringify({ verdict: "can_wait", reason: "Nothing to do right now." });
};
const brief = await buildMorningBrief({ callTool: callTool as any, complete, model: "demo" },
  { actorId: "dev-local-user", botId: "openduet", initiator: { type: "user", id: "dev-local-user" } as any, person: { name: "Jordan Rivera", email: "jordan.rivera@students.lakeviewhs.org" }, since: new Date(Date.now() - 7 * 864e5).toISOString() });
console.log(JSON.stringify(brief));
process.exit(0);
