# AI Learning Companion

A desktop learning workspace built with Electron, React, TypeScript, Vite, Tailwind CSS v4, shadcn/ui-style Radix components, and Lucide icons.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

`npm run dev` runs the renderer, watches the Electron TypeScript files, and opens a native Electron window. Restart the Electron process after changing main or preload code. `npm run dev:web` runs the renderer alone at http://127.0.0.1:5173.

```sh
npm run build
npm start
npm test
```

The build creates `dist/` and `dist-electron/`. `npm start` opens the production build. Tests launch the real Electron application, verify renderer isolation, and exercise the six screens and complete mock journeys. Build before testing. Screenshots are saved in `test-results/`.

## Included

- Dashboard with recent sessions, actions, progress, and recommendations.
- Guided mock learning sessions with a conversation, stored transcripts, summaries, and highlights.
- Configurable three-question interviews with answers and a self-reflection report.
- Study plans, task creation, deadlines, completion filters, and computed progress.
- Filterable opportunities, details, bookmarks, search, and empty states.
- Locally saved preferences, collapsible navigation, light/dark themes, and Ctrl/Cmd+K workspace search.

All AI responses are scripted. Opportunities include illustrative and fictional listings; enrollment and applications are not connected. Language and reminder selections store preferences only. Integrations and secure API configuration are clearly marked as upcoming. No API keys are collected.

## Architecture

`electron/main.cts` creates a sandboxed window with context isolation enabled and Node integration disabled. `electron/preload.cts` exposes only a version query. The renderer is in `src/`, reusable primitives in `src/components/ui/`, semantic design tokens in `src/styles.css`, and mock data in `src/lib/data.ts`. See `AGENTS.md` for contribution conventions.

Harmless preferences, tasks, study plans, saved opportunities, and completed sessions persist in localStorage on this device. The dashboard seeds a fixed October 12, 2026 demo day; its learning-time and streak metrics are illustrative. Planner progress is computed from actual local task state.
