import { describe, expect, it } from "vitest";
import { createFixtureAnsweringClient } from "../fixtureAnsweringClient";
import { answerBasis, answerNotices, formatAnswerForChat } from "./chatController";

describe("single answer presentation", () => {
  it("prefers cited document synthesis over supplementary general knowledge in legacy answers", async () => {
    const answer = await createFixtureAnsweringClient({ delay: 0 }).ask(
      "source",
      true,
    );
    const text = formatAnswerForChat({
      ...answer,
      general_knowledge: "Unverified extra advice.",
    });
    expect(text).toContain(answer.documents[0].text);
    expect(text).toContain("[1]");
    expect(text).not.toContain("Unverified extra advice");
    expect(text).not.toContain("###");
  });
  it("presents general knowledge as one answer without a duplicate insufficient-evidence warning", async () => {
    const answer = await createFixtureAnsweringClient({ delay: 0 }).ask(
      "no evidence",
      true,
    );
    const text = formatAnswerForChat({
      ...answer,
      general_knowledge: "A general answer.",
      limitations: [],
      warnings: [{ code: "insufficient_evidence", message: "No documents." }],
    });
    expect(text).toBe("A general answer.");
  });
  it("keeps partial evidence limits and safety warnings visible", async () => {
    const answer = await createFixtureAnsweringClient({ delay: 0 }).ask(
      "source",
      true,
    );
    const text = formatAnswerForChat({
      ...answer,
      limitations: ["No substitute is named."],
      warnings: [
        {
          code: "citation_validation_failed",
          message: "Unsupported claims were withheld.",
        },
      ],
    });
    expect(text).toContain("No substitute is named.");
    // Safety warnings render once in the answer's notice, not inside the editable text.
    expect(text).not.toContain("Unsupported claims were withheld.");
    expect(answerNotices({ ...answer, warnings: [
      { code: "citation_validation_failed", message: "Unsupported claims were withheld." },
      { code: "citation_validation_failed", message: "Unsupported claims were withheld." },
      { code: "insufficient_evidence", message: "No documents." },
      { code: "history_save_failed", message: "Not saved." },
    ] })).toEqual(["Unsupported claims were withheld."]);
  });
  it("labels each response with exactly one basis", async () => {
    const answer = await createFixtureAnsweringClient({ delay: 0 }).ask("source", true);
    expect(answerBasis({ ...answer, general_knowledge: "Extra." })).toBe("documents");
    expect(answerBasis({ ...answer, documents: [], general_knowledge: "General." })).toBe("general");
    expect(answerBasis({ ...answer, documents: [], general_knowledge: null })).toBe("none");
  });
});
