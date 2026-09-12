# Reaction Time Lab

Reaction Time Lab is an interactive browser experiment for exploring two ideas from cognitive psychology:

- **Choice reaction time:** how quickly a person selects the correct response from four alternatives.
- **Stroop interference:** how a conflicting color word can affect the speed of identifying its ink color.

The project combines cognitive science, experimental design, front-end development and transparent data analysis. It is an educational demonstration, not a clinical or athletic diagnostic tool.

## Live features

- Animated countdown, fixation point, randomized stimulus timing and immediate feedback
- Keyboard and touch controls for red, green, blue and yellow responses
- Trial-level reaction time, accuracy and quality classification
- Median reaction time, fastest clean response and median absolute deviation
- Stroop-effect estimate from congruent and incongruent trials
- Animated trial chart and CSV download
- Browser-only data handling with no account, database or personal-data collection
- Responsive layout and reduced-motion accessibility support

## How the experiment works

The app waits for a random interval between 700 and 1,600 milliseconds before presenting each target. Timing begins with the browser's high-resolution `performance.now()` clock when the target appears and ends when a response is recorded.

Responses faster than 100 milliseconds are marked as anticipations. Responses slower than 2,000 milliseconds are marked as lapses. Only correct, clean trials are used for speed summaries. Accuracy uses every completed trial.

The median is reported instead of only a mean because it is less sensitive to an unusually slow response. Variability is represented by median absolute deviation for the same reason.

## Run locally

1. Install Node.js 20 or newer.
2. Open a terminal in this project folder.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open the local address shown in the terminal.

## Test and build

- `npm test` checks the core calculation rules.
- `npm run build` creates a production-ready version in `dist`.

## Limitations

Browser measurements are affected by the computer or phone, display refresh rate, keyboard or touch hardware, browser workload, fatigue and distraction. Results from different devices should not be treated as perfectly comparable.

## Technology

React, TypeScript, Vite, CSS animation and Vitest.
