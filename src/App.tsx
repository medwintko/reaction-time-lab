import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  classifyReactionTime,
  summarizeTrials,
  trialsToCsv,
  type ResponseKey,
  type TaskType,
  type TrialBlock,
  type TrialRecord,
} from "./lib/metrics";

// One color map keeps names, keys and visual colors synchronized throughout the study.
const COLORS: Record<ResponseKey, { name: string; hex: string }> = {
  r: { name: "Red", hex: "#ff5b55" },
  g: { name: "Green", hex: "#35d087" },
  b: { name: "Blue", hex: "#5c9cff" },
  y: { name: "Yellow", hex: "#ffd45c" },
};

// Arrays make balancing, randomization and keyboard validation straightforward.
const RESPONSE_KEYS = Object.keys(COLORS) as ResponseKey[];

// Practice is brief, while recorded blocks contain enough trials for a useful demonstration.
const PRACTICE_TRIALS = 4;
const RECORDED_TRIALS: Record<TaskType, number> = { choice: 16, stroop: 24 };

// Explicit phases prevent responses from being recorded outside a visible stimulus window.
type Phase =
  | "idle"
  | "setup"
  | "countdown"
  | "waiting"
  | "active"
  | "feedback"
  | "break"
  | "complete";

// A planned stimulus stores the answer and, for Stroop trials, the displayed word condition.
interface Stimulus {
  target: ResponseKey;
  word: ResponseKey | null;
  congruent: boolean | null;
}

// Compact local-history entries avoid storing raw trial data without an explicit download.
interface HistoryEntry {
  sessionId: string;
  task: TaskType;
  completedAt: string;
  medianReactionTimeMs: number | null;
  accuracyPercent: number;
  stroopEffectMs: number | null;
}

// Fisher-Yates shuffling gives every balanced plan a fresh randomized order.
function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

// Generate balanced targets and exactly equal Stroop conditions for every recorded block.
function makeTrialPlan(task: TaskType, count: number): Stimulus[] {
  if (task === "choice") {
    return shuffle(
      Array.from({ length: count }, (_, index) => ({
        target: RESPONSE_KEYS[index % RESPONSE_KEYS.length],
        word: null,
        congruent: null,
      })),
    );
  }

  const congruentCount = Math.floor(count / 2);
  const conditions = shuffle(
    Array.from({ length: count }, (_, index) => index < congruentCount),
  );

  return shuffle(
    conditions.map((congruent, index) => {
      const target = RESPONSE_KEYS[index % RESPONSE_KEYS.length];
      const conflictingWords = RESPONSE_KEYS.filter((key) => key !== target);
      const word = congruent
        ? target
        : conflictingWords[Math.floor(Math.random() * conflictingWords.length)];

      return { target, word, congruent };
    }),
  );
}

// Anonymous codes identify sessions without asking for a name, email address or account.
function makeId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${randomPart}`;
}

// Missing values remain visibly missing instead of being misrepresented as zero milliseconds.
function milliseconds(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

// Read only the small summary history previously saved by this application.
function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem("reaction-time-history") ?? "[]") as HistoryEntry[];
  } catch {
    return [];
  }
}

// The bar chart exposes trial-by-trial variation rather than only a headline average.
function ResultsChart({ trials }: { trials: TrialRecord[] }) {
  const chartTrials = trials.filter(
    (trial) => trial.block === "recorded" && trial.quality === "clean",
  );
  const maximum = Math.max(...chartTrials.map((trial) => trial.reactionTimeMs), 1);

  if (chartTrials.length === 0) {
    return <p className="empty-chart">No clean recorded trials were available to chart.</p>;
  }

  return (
    <div className="trial-chart" aria-label="Reaction time by recorded trial">
      {chartTrials.map((trial) => (
        <div className="bar-column" key={`${trial.block}-${trial.trial}`}>
          <span className="bar-value">{Math.round(trial.reactionTimeMs)}</span>
          <div className="bar-track">
            <div
              className={`bar-fill ${trial.correct ? "correct" : "incorrect"}`}
              style={{ height: `${Math.max(8, (trial.reactionTimeMs / maximum) * 100)}%` }}
            />
          </div>
          <span className="bar-label">{trial.trial}</span>
        </div>
      ))}
    </div>
  );
}

// A compact scatterplot makes the speed-accuracy trade-off visible for individual responses.
function SpeedAccuracyPlot({ trials }: { trials: TrialRecord[] }) {
  const plottedTrials = trials.filter(
    (trial) => trial.block === "recorded" && trial.quality === "clean",
  );

  if (plottedTrials.length === 0) {
    return <p className="empty-chart">No clean recorded trials were available to plot.</p>;
  }

  return (
    <div className="speed-accuracy-plot" aria-label="Reaction time by response accuracy">
      <div className="plot-label correct-label">Correct</div>
      <div className="plot-label error-label">Error</div>
      <div className="plot-grid" aria-hidden="true">
        <span /><span /><span /><span /><span />
      </div>
      {plottedTrials.map((trial) => {
        const boundedTime = Math.min(2000, Math.max(100, trial.reactionTimeMs));
        const horizontalPosition = ((boundedTime - 100) / 1900) * 100;

        return (
          <span
            className={`plot-dot ${trial.correct ? "correct" : "incorrect"}`}
            key={`plot-${trial.trial}`}
            style={{ left: `${horizontalPosition}%`, top: trial.correct ? "25%" : "72%" }}
            title={`Trial ${trial.trial}: ${Math.round(trial.reactionTimeMs)} ms, ${trial.correct ? "correct" : "incorrect"}`}
          />
        );
      })}
      <div className="plot-axis"><span>100 ms</span><span>2,000 ms</span></div>
    </div>
  );
}

// The main component coordinates study setup, practice, recording, analysis and export.
export default function App() {
  // Participant-facing state controls task choice and each stage of the study flow.
  const [task, setTask] = useState<TaskType>("choice");
  const [phase, setPhase] = useState<Phase>("idle");
  const [block, setBlock] = useState<TrialBlock>("practice");
  const [countdown, setCountdown] = useState(3);
  const [stimulus, setStimulus] = useState<Stimulus | null>(null);
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [feedback, setFeedback] = useState("Read the study overview, then begin when ready.");
  const [falseStarts, setFalseStarts] = useState(0);
  const [consented, setConsented] = useState(false);
  const [participantId, setParticipantId] = useState(() => makeId("P"));
  const [sessionId, setSessionId] = useState(() => makeId("S"));
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  // Refs preserve precise timing, randomized plans and current state inside event handlers.
  const stimulusStartedAt = useRef(0);
  const phaseRef = useRef<Phase>(phase);
  const taskRef = useRef<TaskType>(task);
  const blockRef = useRef<TrialBlock>(block);
  const stimulusRef = useRef<Stimulus | null>(stimulus);
  const trialsRef = useRef<TrialRecord[]>(trials);
  const planRef = useRef<Stimulus[]>([]);
  const planIndexRef = useRef(0);
  const waitTimer = useRef<number | null>(null);
  const feedbackTimer = useRef<number | null>(null);

  // Synchronize refs whenever display state changes so fast responses use current values.
  useEffect(() => void (phaseRef.current = phase), [phase]);
  useEffect(() => void (taskRef.current = task), [task]);
  useEffect(() => void (blockRef.current = block), [block]);
  useEffect(() => void (stimulusRef.current = stimulus), [stimulus]);
  useEffect(() => void (trialsRef.current = trials), [trials]);

  // Clear scheduled work when the component closes, a task changes or a block restarts.
  const clearTimers = useCallback(() => {
    if (waitTimer.current !== null) window.clearTimeout(waitTimer.current);
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // A randomized foreperiod reduces rhythmic anticipation before every stimulus.
  const scheduleStimulus = useCallback(() => {
    clearTimers();
    setStimulus(null);
    setPhase("waiting");
    setFeedback("Wait for the signal…");

    const randomizedDelay = 700 + Math.random() * 900;

    waitTimer.current = window.setTimeout(() => {
      const nextStimulus = planRef.current[planIndexRef.current];

      stimulusRef.current = nextStimulus;
      setStimulus(nextStimulus);
      setPhase("active");
      stimulusStartedAt.current = performance.now();
      setFeedback(
        taskRef.current === "choice"
          ? "Match the target color."
          : "Respond to the ink color, not the word.",
      );
    }, randomizedDelay);
  }, [clearTimers]);

  // A three-step preparation countdown precedes both practice and recorded blocks.
  useEffect(() => {
    if (phase !== "countdown") return;

    if (countdown === 0) {
      scheduleStimulus();
      return;
    }

    const countdownTimer = window.setTimeout(
      () => setCountdown((current) => current - 1),
      700,
    );

    return () => window.clearTimeout(countdownTimer);
  }, [countdown, phase, scheduleStimulus]);

  // Start one balanced block and reset only the state that belongs to that block.
  const beginBlock = useCallback(
    (nextBlock: TrialBlock) => {
      clearTimers();
      const trialCount = nextBlock === "practice" ? PRACTICE_TRIALS : RECORDED_TRIALS[taskRef.current];

      blockRef.current = nextBlock;
      setBlock(nextBlock);
      planRef.current = makeTrialPlan(taskRef.current, trialCount);
      planIndexRef.current = 0;
      setFalseStarts(0);
      setCountdown(3);
      setStimulus(null);
      setFeedback(nextBlock === "practice" ? "Practice block: get ready." : "Recorded block: get ready.");
      setPhase("countdown");
    },
    [clearTimers],
  );

  // Consent creates fresh anonymous identifiers and begins practice with an empty dataset.
  const beginStudy = () => {
    if (!consented) return;

    const nextParticipantId = makeId("P");
    const nextSessionId = makeId("S");

    setParticipantId(nextParticipantId);
    setSessionId(nextSessionId);
    setTrials([]);
    trialsRef.current = [];
    beginBlock("practice");
  };

  // Save only a small result summary locally after the recorded block is finished.
  const saveSessionSummary = useCallback(
    (completedTrials: TrialRecord[]) => {
      const completedSummary = summarizeTrials(completedTrials);
      const entry: HistoryEntry = {
        sessionId,
        task: taskRef.current,
        completedAt: new Date().toISOString(),
        medianReactionTimeMs: completedSummary.medianReactionTimeMs,
        accuracyPercent: completedSummary.accuracyPercent,
        stroopEffectMs: completedSummary.stroopEffectMs,
      };
      const nextHistory = [entry, ...history].slice(0, 5);

      setHistory(nextHistory);
      localStorage.setItem("reaction-time-history", JSON.stringify(nextHistory));
    },
    [history, sessionId],
  );

  // Record one response, then either advance the randomized plan or end the current block.
  const handleResponse = useCallback(
    (response: ResponseKey) => {
      if (phaseRef.current === "waiting") {
        setFalseStarts((current) => current + 1);
        setFeedback("Too soon. The same trial will restart.");
        scheduleStimulus();
        return;
      }

      if (phaseRef.current !== "active" || stimulusRef.current === null) return;

      const reactionTimeMs = performance.now() - stimulusStartedAt.current;
      const currentStimulus = stimulusRef.current;
      const currentBlock = blockRef.current;
      const blockTrialNumber =
        trialsRef.current.filter((trial) => trial.block === currentBlock).length + 1;
      const correct = response === currentStimulus.target;
      const newTrial: TrialRecord = {
        sessionId,
        participantId,
        trial: blockTrialNumber,
        block: currentBlock,
        task: taskRef.current,
        target: currentStimulus.target,
        response,
        correct,
        congruent: currentStimulus.congruent,
        reactionTimeMs,
        quality: classifyReactionTime(reactionTimeMs),
        completedAt: new Date().toISOString(),
      };
      const updatedTrials = [...trialsRef.current, newTrial];

      trialsRef.current = updatedTrials;
      setTrials(updatedTrials);
      setPhase("feedback");
      setFeedback(correct ? `${Math.round(reactionTimeMs)} ms · correct` : "Incorrect response");

      feedbackTimer.current = window.setTimeout(() => {
        const isFinalTrial = planIndexRef.current >= planRef.current.length - 1;

        if (isFinalTrial && currentBlock === "practice") {
          setStimulus(null);
          setPhase("break");
          setFeedback("Practice complete. Your next block will be recorded.");
          return;
        }

        if (isFinalTrial) {
          setStimulus(null);
          setPhase("complete");
          setFeedback("Session complete. Review the recorded results below.");
          saveSessionSummary(updatedTrials);
          return;
        }

        planIndexRef.current += 1;
        scheduleStimulus();
      }, 550);
    },
    [participantId, saveSessionSummary, scheduleStimulus, sessionId],
  );

  // Global keyboard controls provide more consistent desktop input than pointer movement.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase() as ResponseKey;

      if (RESPONSE_KEYS.includes(key) && !event.repeat) handleResponse(key);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleResponse]);

  // All result views share the same tested summary function.
  const summary = useMemo(() => summarizeTrials(trials), [trials]);
  const blockTrials = trials.filter((trial) => trial.block === block);
  const blockTotal = block === "practice" ? PRACTICE_TRIALS : RECORDED_TRIALS[task];
  const progressPercent = (blockTrials.length / blockTotal) * 100;

  // Interpretation stays cautious because a short browser study cannot establish a diagnosis.
  const interpretation = useMemo(() => {
    if (summary.recordedTrials === 0) return "Complete the recorded block to generate an interpretation.";
    const accuracyText = summary.accuracyPercent >= 90
      ? "Accuracy was high, so the speed estimate is less likely to reflect guessing."
      : "Some errors occurred, so reaction time should be interpreted alongside accuracy.";

    if (task === "stroop" && summary.stroopEffectMs !== null) {
      const direction = summary.stroopEffectMs > 0
        ? `Incongruent trials were ${Math.round(summary.stroopEffectMs)} ms slower at the median, consistent with Stroop interference in this session.`
        : "This short session did not show the typical positive Stroop-interference pattern.";
      return `${direction} ${accuracyText}`;
    }

    return `The median summarizes typical choice-response speed across clean, correct trials. ${accuracyText}`;
  }, [summary, task]);

  // Download all practice and recorded observations; the block column keeps them separable.
  const downloadCsv = () => {
    const blob = new Blob([trialsToCsv(trials)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `reaction-time-${task}-${sessionId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Task changes are allowed only outside an active study and clear the previous screen state.
  const chooseTask = (selectedTask: TaskType) => {
    if (!['idle', 'setup', 'complete'].includes(phase)) return;
    setTask(selectedTask);
    taskRef.current = selectedTask;
    setTrials([]);
    trialsRef.current = [];
    setConsented(false);
    setPhase("idle");
    setFeedback("Read the study overview, then begin when ready.");
  };

  // A completed session can be cleared without deleting prior summaries from local history.
  const resetStudy = () => {
    setTrials([]);
    trialsRef.current = [];
    setConsented(false);
    setParticipantId(makeId("P"));
    setSessionId(makeId("S"));
    setPhase("idle");
    setFeedback("Read the study overview, then begin when ready.");
    window.location.hash = "experiment";
  };

  return (
    <main>
      {/* The hero introduces the scientific question with an abstract cognitive pathway. */}
      <header className="hero" id="top">
        <nav className="nav-shell" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="Reaction Time Lab home">
            <span className="brand-mark" aria-hidden="true">RT</span>
            <span>Reaction Time Lab</span>
          </a>
          <div className="nav-links">
            <a href="#experiment">Experiment</a>
            <a href="#methodology">Methodology</a>
            <a href="#privacy">Privacy</a>
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow"><span /> Interactive cognitive experiment</p>
            <h1>Measure the moment between <em>signal</em> and action.</h1>
            <p className="hero-lede">
              Explore choice reaction time and Stroop interference through a balanced,
              browser-based experiment with practice trials and transparent analysis.
            </p>
            <a className="primary-link" href="#experiment">Run the study <span>↓</span></a>
          </div>

          <div className="track-visual" aria-hidden="true">
            <div className="orb orb-one" />
            <div className="orb orb-two" />
            <div className="track-lines"><span /><span /><span /><span /></div>
            <div className="signal-wave"><i /><i /><i /></div>
            <div className="runner-dot" />
            <p>PERCEPTION <b>→</b> DECISION <b>→</b> RESPONSE</p>
          </div>
        </div>
      </header>

      {/* The live study combines task selection, consent, practice and recorded blocks. */}
      <section className="lab-section" id="experiment">
        <div className="section-heading">
          <div>
            <p className="eyebrow dark"><span /> Study protocol</p>
            <h2>Practice first. Record second. Interpret carefully.</h2>
          </div>
          <p>Use a keyboard for the most consistent timing. Mobile buttons work too.</p>
        </div>

        <div className="hypothesis-card">
          <span>Hypothesis</span>
          <p>
            {task === "choice"
              ? "Participants will respond accurately to color targets, with reaction time varying across trials."
              : "Responses will be slower on incongruent trials than congruent trials because the word competes with the ink-color response."}
          </p>
        </div>

        <div className="task-tabs" role="tablist" aria-label="Choose an experiment">
          <button className={task === "choice" ? "selected" : ""} onClick={() => chooseTask("choice")} role="tab" aria-selected={task === "choice"}>
            <span>01</span> Choice reaction
          </button>
          <button className={task === "stroop" ? "selected" : ""} onClick={() => chooseTask("stroop")} role="tab" aria-selected={task === "stroop"}>
            <span>02</span> Stroop interference
          </button>
        </div>

        <div className="experiment-shell">
          <aside className="instruction-panel">
            <p className="panel-number">{task === "choice" ? "01" : "02"}</p>
            <h3>{task === "choice" ? "Choice reaction" : "Stroop interference"}</h3>
            <p>
              {task === "choice"
                ? "Press the key matching the colored target as quickly and accurately as possible."
                : "Press the key matching the word’s ink color. Ignore the meaning of the word."}
            </p>
            <div className="key-guide">
              {RESPONSE_KEYS.map((key) => <span key={key}><kbd>{key.toUpperCase()}</kbd>{COLORS[key].name}</span>)}
            </div>
            <p className="trial-count">
              {PRACTICE_TRIALS} practice · {RECORDED_TRIALS[task]} recorded trials
            </p>
          </aside>

          <div className={`stimulus-panel phase-${phase}`}>
            <div className="progress-row">
              <span>{block === "practice" ? "Practice" : "Recorded"} · Trial {Math.min(blockTrials.length + 1, blockTotal)} / {blockTotal}</span>
              <span>{falseStarts} false start{falseStarts === 1 ? "" : "s"}</span>
            </div>
            <div className="progress-track"><span style={{ width: `${progressPercent}%` }} /></div>

            <div className="stimulus-stage" aria-live="polite">
              {phase === "idle" && <button className="start-button" onClick={() => setPhase("setup")}>Review & begin</button>}

              {phase === "setup" && (
                <div className="study-setup">
                  <p className="setup-kicker">Before you begin</p>
                  <h3>Anonymous educational study</h3>
                  <ul>
                    <li>You will complete a short practice block before recorded trials.</li>
                    <li>Participation is voluntary; you may stop by closing the page.</li>
                    <li>No name, email, account or clinical information is collected.</li>
                    <li>Device and browser latency can affect measurements.</li>
                  </ul>
                  <label className="consent-row">
                    <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} />
                    <span>I understand and voluntarily agree to participate.</span>
                  </label>
                  <button className="start-button" disabled={!consented} onClick={beginStudy}>Begin practice</button>
                </div>
              )}

              {phase === "countdown" && <div className="countdown" key={countdown}>{countdown || "GO"}</div>}
              {phase === "waiting" && <div className="focus-point" />}
              {phase === "active" && stimulus && task === "choice" && (
                <div className="color-target" style={{ backgroundColor: COLORS[stimulus.target].hex }} aria-label={`${COLORS[stimulus.target].name} target`} />
              )}
              {phase === "active" && stimulus && task === "stroop" && stimulus.word && (
                <p className="stroop-word" style={{ color: COLORS[stimulus.target].hex }}>{COLORS[stimulus.word].name.toUpperCase()}</p>
              )}
              {phase === "break" && (
                <div className="block-break">
                  <span>✓</span>
                  <h3>Practice complete</h3>
                  <p>Practice responses will not affect your result. The next {RECORDED_TRIALS[task]} trials will be analyzed.</p>
                  <button className="start-button" onClick={() => beginBlock("recorded")}>Begin recorded block</button>
                </div>
              )}
              {phase === "complete" && <div className="complete-mark"><span>✓</span><strong>Study complete</strong></div>}
            </div>

            <p className="feedback-line">{feedback}</p>
            <div className="response-buttons">
              {RESPONSE_KEYS.map((key) => (
                <button key={key} onClick={() => handleResponse(key)} disabled={!['waiting', 'active'].includes(phase)} style={{ "--key-color": COLORS[key].hex } as React.CSSProperties}>
                  <kbd>{key.toUpperCase()}</kbd><span>{COLORS[key].name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Results appear only after the complete recorded block has finished. */}
      <section className={`results-section ${phase === "complete" ? "visible" : ""}`} id="results">
        <div className="section-heading light">
          <div><p className="eyebrow"><span /> Recorded results</p><h2>Speed tells one part of the story.</h2></div>
          <p>Practice is excluded. Accuracy and variability are reported with reaction time.</p>
        </div>

        <div className="session-meta">
          <span>Participant {participantId}</span><span>Session {sessionId}</span><span>{summary.recordedTrials} recorded trials</span>
        </div>

        <div className="metric-grid">
          <article><p>Median reaction</p><strong>{milliseconds(summary.medianReactionTimeMs)}</strong><small>clean correct trials</small></article>
          <article><p>Accuracy</p><strong>{summary.accuracyPercent.toFixed(0)}%</strong><small>all recorded trials</small></article>
          <article><p>Fastest reaction</p><strong>{milliseconds(summary.bestReactionTimeMs)}</strong><small>clean correct trials</small></article>
          <article><p>Variability</p><strong>{milliseconds(summary.variabilityMs)}</strong><small>median absolute deviation</small></article>
        </div>

        {task === "stroop" && (
          <div className="condition-grid">
            <article><span>Congruent median</span><strong>{milliseconds(summary.congruentMedianMs)}</strong></article>
            <article><span>Incongruent median</span><strong>{milliseconds(summary.incongruentMedianMs)}</strong></article>
            <article><span>Stroop effect</span><strong>{milliseconds(summary.stroopEffectMs)}</strong></article>
          </div>
        )}

        <div className="interpretation-card"><span>Interpretation</span><p>{interpretation}</p></div>

        <div className="analysis-grid">
          <div className="chart-card">
            <div className="chart-title"><div><p>Trial profile</p><h3>Reaction time by trial</h3></div><span>milliseconds</span></div>
            <ResultsChart trials={trials} />
          </div>
          <div className="chart-card">
            <div className="chart-title"><div><p>Decision profile</p><h3>Speed–accuracy trade-off</h3></div><span>recorded trials</span></div>
            <SpeedAccuracyPlot trials={trials} />
          </div>
        </div>

        <div className="results-actions">
          <button className="download-button" onClick={downloadCsv}>Download complete data (.csv)</button>
          <button className="text-button" onClick={resetStudy}>Start a new study ↗</button>
        </div>

        {history.length > 0 && (
          <div className="history-card">
            <div><p>Stored on this device</p><h3>Recent sessions</h3></div>
            <div className="history-list">
              {history.map((entry) => (
                <article key={entry.sessionId}>
                  <span>{entry.task === "choice" ? "Choice" : "Stroop"}</span>
                  <strong>{milliseconds(entry.medianReactionTimeMs)}</strong>
                  <small>{entry.accuracyPercent.toFixed(0)}% accuracy</small>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Methodology documents design choices and analysis rules for reproducibility. */}
      <section className="method-section" id="methodology">
        <div className="section-heading"><div><p className="eyebrow dark"><span /> Methodology</p><h2>Clear rules. Visible assumptions.</h2></div></div>
        <div className="method-grid">
          <article><span>01</span><h3>Practice separation</h3><p>Four practice responses teach the controls and remain excluded from primary results.</p></article>
          <article><span>02</span><h3>Balanced conditions</h3><p>Recorded Stroop blocks contain equal numbers of congruent and incongruent trials in random order.</p></article>
          <article><span>03</span><h3>Randomized intervals</h3><p>Signals appear after a random 700–1,600 ms wait to reduce predictable anticipation.</p></article>
          <article><span>04</span><h3>Robust summaries</h3><p>Median speed and median absolute deviation reduce the influence of unusual trials.</p></article>
        </div>
        <div className="limitation-note"><strong>Interpret with care.</strong><p>Device latency, screen refresh rate, input hardware, fatigue and distraction can affect results. Responses below 100 ms are marked as anticipations and those above 2,000 ms as lapses. This educational project is not a clinical or athletic diagnostic tool.</p></div>
      </section>

      {/* Privacy language distinguishes temporary trial data from optional local summaries. */}
      <section className="privacy-section" id="privacy">
        <p className="eyebrow"><span /> Privacy by design</p>
        <h2>No account. No identity. No server upload.</h2>
        <p>Raw responses remain in this browser tab unless you download them. Up to five summary results are stored only in this browser so you can compare sessions; clearing site data removes them.</p>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark">RT</span><span>Reaction Time Lab</span></a>
        <p>Built to explore cognition through transparent, interactive data.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}
