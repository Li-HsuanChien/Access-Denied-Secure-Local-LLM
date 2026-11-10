import { describe, expect, it } from "vitest";
import { createFixtureAnsweringClient } from "../fixtureAnsweringClient";
import { formatAnswerForChat } from "./chatController";

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
    expect(text).toContain("Unsupported claims were withheld.");
  });
});
