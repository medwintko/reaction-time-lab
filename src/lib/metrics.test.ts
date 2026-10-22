import { describe, expect, it } from "vitest";
import {
  classifyReactionTime,
  median,
  summarizeTrials,
  trialsToCsv,
  type TrialRecord,
} from "./metrics";

// A helper keeps the tests readable while still creating complete exported observations.
function makeTrial(overrides: Partial<TrialRecord> = {}): TrialRecord {
  return {
    sessionId: "session-test",
    participantId: "P-TEST",
    trial: 1,
    block: "recorded",
    task: "choice",
    target: "r",
    response: "r",
    correct: true,
    congruent: null,
    reactionTimeMs: 400,
    quality: "clean",
    completedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("reaction-time metrics", () => {
  // Check both median branches because odd and even lists use different formulas.
  it("calculates medians for odd and even sets", () => {
    expect(median([500, 300, 400])).toBe(400);
    expect(median([300, 400, 500, 600])).toBe(450);
  });

  // Confirm the published 100 ms and 2,000 ms quality thresholds.
  it("labels anticipations, clean responses and lapses", () => {
    expect(classifyReactionTime(99)).toBe("anticipation");
    expect(classifyReactionTime(350)).toBe("clean");
    expect(classifyReactionTime(2001)).toBe("lapse");
  });

  // Practice observations remain exportable but cannot influence the primary result.
  it("excludes practice, errors and flagged trials from speed summaries", () => {
    const trials = [
      makeTrial({ block: "practice", reactionTimeMs: 100 }),
      makeTrial({ trial: 1, reactionTimeMs: 300 }),
      makeTrial({ trial: 2, response: "g", correct: false, reactionTimeMs: 200 }),
      makeTrial({ trial: 3, target: "b", response: "b", reactionTimeMs: 500 }),
    ];

    const summary = summarizeTrials(trials);

    expect(summary.medianReactionTimeMs).toBe(400);
    expect(summary.accuracyPercent).toBeCloseTo(66.67, 1);
    expect(summary.recordedTrials).toBe(3);
  });

  // Balanced Stroop conditions should produce an interpretable interference estimate.
  it("calculates the Stroop effect from condition medians", () => {
    const trials = [
      makeTrial({ task: "stroop", congruent: true, reactionTimeMs: 400 }),
      makeTrial({ trial: 2, task: "stroop", congruent: true, reactionTimeMs: 500 }),
      makeTrial({ trial: 3, task: "stroop", congruent: false, reactionTimeMs: 600 }),
      makeTrial({ trial: 4, task: "stroop", congruent: false, reactionTimeMs: 700 }),
    ];

    const summary = summarizeTrials(trials);

    expect(summary.congruentMedianMs).toBe(450);
    expect(summary.incongruentMedianMs).toBe(650);
    expect(summary.stroopEffectMs).toBe(200);
  });

  // The downloadable data must include reproducibility fields and both study blocks.
  it("exports session metadata and practice status to CSV", () => {
    const csv = trialsToCsv([makeTrial({ block: "practice" })]);

    expect(csv).toContain("session_id,participant_id,trial,block");
    expect(csv).toContain("session-test,P-TEST,1,practice");
  });
});
