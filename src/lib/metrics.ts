// The four response keys map directly to the four colors displayed in the experiment.
export type ResponseKey = "r" | "g" | "b" | "y";

// A task identifier lets exported observations be separated by experimental paradigm.
export type TaskType = "choice" | "stroop";

// Practice trials teach the task but are deliberately excluded from primary analyses.
export type TrialBlock = "practice" | "recorded";

// Each completed response becomes one transparent, analysis-ready observation.
export interface TrialRecord {
  sessionId: string;
  participantId: string;
  trial: number;
  block: TrialBlock;
  task: TaskType;
  target: ResponseKey;
  response: ResponseKey;
  correct: boolean;
  congruent: boolean | null;
  reactionTimeMs: number;
  quality: "clean" | "anticipation" | "lapse";
  completedAt: string;
}

// Summary values stay together so the interface, export and tests use identical rules.
export interface SummaryMetrics {
  medianReactionTimeMs: number | null;
  accuracyPercent: number;
  bestReactionTimeMs: number | null;
  variabilityMs: number | null;
  stroopEffectMs: number | null;
  congruentMedianMs: number | null;
  incongruentMedianMs: number | null;
  cleanTrials: number;
  recordedTrials: number;
}

// Median is more resistant to an unusually slow response than a simple arithmetic mean.
export function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sortedValues = [...values].sort((first, second) => first - second);
  const midpoint = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 1) return sortedValues[midpoint];

  return (sortedValues[midpoint - 1] + sortedValues[midpoint]) / 2;
}

// Published quality thresholds make data cleaning explicit rather than silently dropping trials.
export function classifyReactionTime(reactionTimeMs: number): TrialRecord["quality"] {
  if (reactionTimeMs < 100) return "anticipation";
  if (reactionTimeMs > 2000) return "lapse";
  return "clean";
}

// Primary summaries use recorded trials only; speed measures also require correct, clean trials.
export function summarizeTrials(trials: TrialRecord[]): SummaryMetrics {
  const recordedTrials = trials.filter((trial) => trial.block === "recorded");
  const cleanCorrectTrials = recordedTrials.filter(
    (trial) => trial.correct && trial.quality === "clean",
  );
  const cleanTimes = cleanCorrectTrials.map((trial) => trial.reactionTimeMs);
  const medianReactionTimeMs = median(cleanTimes);
  const absoluteDeviations = cleanTimes.map((time) =>
    Math.abs(time - (medianReactionTimeMs ?? time)),
  );
  const congruentTimes = cleanCorrectTrials
    .filter((trial) => trial.congruent === true)
    .map((trial) => trial.reactionTimeMs);
  const incongruentTimes = cleanCorrectTrials
    .filter((trial) => trial.congruent === false)
    .map((trial) => trial.reactionTimeMs);
  const congruentMedianMs = median(congruentTimes);
  const incongruentMedianMs = median(incongruentTimes);

  return {
    medianReactionTimeMs,
    accuracyPercent:
      recordedTrials.length === 0
        ? 0
        : (recordedTrials.filter((trial) => trial.correct).length / recordedTrials.length) * 100,
    bestReactionTimeMs: cleanTimes.length === 0 ? null : Math.min(...cleanTimes),
    variabilityMs: median(absoluteDeviations),
    stroopEffectMs:
      congruentMedianMs === null || incongruentMedianMs === null
        ? null
        : incongruentMedianMs - congruentMedianMs,
    congruentMedianMs,
    incongruentMedianMs,
    cleanTrials: cleanCorrectTrials.length,
    recordedTrials: recordedTrials.length,
  };
}

// CSV export includes session metadata and both blocks so another analyst can audit the study.
export function trialsToCsv(trials: TrialRecord[]): string {
  const header = [
    "session_id",
    "participant_id",
    "trial",
    "block",
    "task",
    "target",
    "response",
    "correct",
    "congruent",
    "reaction_time_ms",
    "quality",
    "completed_at",
  ];
  const rows = trials.map((trial) => [
    trial.sessionId,
    trial.participantId,
    trial.trial,
    trial.block,
    trial.task,
    trial.target,
    trial.response,
    trial.correct,
    trial.congruent ?? "not_applicable",
    Math.round(trial.reactionTimeMs),
    trial.quality,
    trial.completedAt,
  ]);

  return [header, ...rows].map((row) => row.join(",")).join("\n");
}
