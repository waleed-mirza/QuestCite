import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEMO_DISABLED_OPERATIONS,
  DEMO_DOCUMENTS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_QUESTIONS,
  DEMO_RUN_STEPS,
  DEMO_DISCLAIMER,
  demoActionAvailability,
  summarizeDemoQuestions,
} from "@/features/demo/data";

describe("Northstar Cloud demo contract", () => {
  it("keeps the fictional seed at the planned shape", () => {
    expect(DEMO_DOCUMENTS).toHaveLength(7);
    expect(DEMO_KNOWLEDGE_ENTRIES).toHaveLength(10);
    expect(DEMO_QUESTIONS).toHaveLength(40);
    expect(DEMO_RUN_STEPS).toHaveLength(4);
    expect(summarizeDemoQuestions()).toEqual({
      totalQuestions: 40,
      groundedDrafts: 32,
      needsReview: 6,
      insufficientEvidence: 2,
      citedDrafts: 38,
    });
  });

  it("keeps every demo document fictional and visibly disclaimed", () => {
    for (const document of DEMO_DOCUMENTS) {
      const fixturePath = path.join(process.cwd(), "demo", "documents", document.filename);
      const contents = readFileSync(fixturePath, "utf8");
      expect(contents).toContain(DEMO_DISCLAIMER);
    }
  });

  it("allows only safe local actions and blocks mutation/provider actions", () => {
    expect(demoActionAvailability("replay_answers").allowed).toBe(true);
    expect(demoActionAvailability("download_sample").allowed).toBe(true);
    expect(demoActionAvailability("live_ai").allowed).toBe(false);
    expect(demoActionAvailability("upload").allowed).toBe(false);
    expect(DEMO_DISABLED_OPERATIONS.map((operation) => operation.action)).toEqual([
      "upload",
      "invite",
      "checkout",
      "delete_workspace",
    ]);
  });

  it("keeps abstentions empty and all cited drafts source-backed", () => {
    for (const question of DEMO_QUESTIONS) {
      if (question.disposition === "insufficient_evidence") {
        expect(question.answer).toBe("");
        expect(question.sourceKey).toBeNull();
      } else {
        expect(question.answer.length).toBeGreaterThan(0);
        expect(question.sourceKey).not.toBeNull();
      }
    }
  });
});
