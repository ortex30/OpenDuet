import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { HelpLevel } from "@openbot/shared/study";
import { helpLevelRank } from "@openbot/shared/study";
import type { PrivatePack } from "../private-pack";
import { StudyInputError } from "./contracts";
import { type GuideInput, schoolSnapshotFromPack } from "./craft";
import { normaliseName, resolveStudyTarget } from "./rules";

/**
 * The class notes a practice test or tutor turn is built from.
 *
 * Help is the class policy. An assignment the student named, such as a quest
 * or an exam, uses the stricter of the two. A unit focus such as "Unit 5"
 * stays on the class policy, so practice from the notes is not treated as
 * doing that assignment.
 */

export function buildGuideInput(
  pack: PrivatePack,
  selector: { classId?: string; className?: string; focus?: string },
  now = new Date(),
): GuideInput {
  const schoolClass = findClass(pack, selector, now);
  if (!schoolClass) {
    const names = pack.classes.map((row) => row.name).join(", ");
    throw new StudyInputError(
      names
        ? `Pick one of your classes: ${names}.`
        : "Pick one of your classes.",
    );
  }
  const upcoming = pack.assignments
    .filter((item) => item.classId === schoolClass.id)
    .sort((a, b) => a.due.localeCompare(b.due));
  const focus = selector.focus?.trim() ?? "";
  const named = focus
    ? upcoming.find((item) => titlesMatch(focus, item.title))
    : (upcoming.find((item) => item.kind !== "assignment") ?? upcoming[0]);
  const asked = focus
    ? upcoming.find(
        (item) =>
          /quest|exam|homework|essay|summative|worksheet/i.test(focus) &&
          titlesMatch(focus, item.title),
      )
    : null;
  return {
    classId: schoolClass.id,
    className: schoolClass.name,
    help: asked ? stricter(schoolClass.help, asked.help) : schoolClass.help,
    focus: focus || named?.title || schoolClass.name,
    due: named?.due ?? null,
    notes: "",
    files: readNotes(pack, schoolClass.materials),
  };
}

function findClass(
  pack: PrivatePack,
  selector: { classId?: string; className?: string; focus?: string },
  now: Date,
) {
  if (selector.classId) {
    const byId = pack.classes.find((row) => row.id === selector.classId);
    if (byId) return byId;
  }
  const named = selector.className?.trim();
  if (!named) return selector.classId ? null : (pack.classes[0] ?? null);
  const snapshot = schoolSnapshotFromPack(pack, now);
  const target = resolveStudyTarget(
    snapshot,
    { classes: {}, assignments: {} },
    { className: named },
    now,
  );
  if (target.ok) {
    return pack.classes.find((row) => row.id === target.classId) ?? null;
  }
  const want = normaliseName(named);
  const shorts = pack.classes.filter((row) => {
    const short = normaliseName(row.shortName ?? "");
    return short.length > 0 && (short === want || short.includes(want));
  });
  return shorts.length === 1 ? shorts[0] : null;
}

function titlesMatch(focus: string, title: string): boolean {
  const a = focus.toLowerCase();
  const b = title.toLowerCase();
  return b.includes(a) || (a.length > 12 && a.includes(b));
}

function stricter(a: HelpLevel, b: HelpLevel): HelpLevel {
  return helpLevelRank(a) >= helpLevelRank(b) ? a : b;
}

export function readNotes(pack: PrivatePack, materials: readonly string[]) {
  return materials.flatMap((path) => {
    const full = resolve(pack.dir, path);
    const root = resolve(pack.dir);
    if (relative(root, full).startsWith("..")) return [];
    try {
      return [{ path, markdown: readFileSync(full, "utf8") }];
    } catch {
      return [];
    }
  });
}
