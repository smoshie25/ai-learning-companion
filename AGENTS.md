# AI Learning Companion

## Architecture
- `electron/main.cts` owns native windows and explicit IPC handlers. `electron/preload.cts` exposes a small typed bridge. `src/` is the React renderer and must never import Electron or Node modules.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Do not expose arbitrary IPC, filesystem, shell, or network access through the bridge.
- Vite builds the renderer into `dist/`; TypeScript builds Electron CommonJS entry points into `dist-electron/`.
- Use React, strict TypeScript, Tailwind v4, shadcn-style Radix primitives in `src/components/ui`, and Lucide icons. Use `@/` aliases for renderer imports.

## UI conventions
- Colors, typography, spacing, radii, and theme values belong in `src/styles.css`. Light and dark modes share semantic tokens.
- Reuse Button, Dialog, page headers, cards, badges, and form controls. All controls need accessible names, visible focus, and keyboard support. Respect reduced motion.
- Use realistic local mock data. Clearly label simulated AI sessions and interviews. No real API integration or collection of API keys in this prototype.
- Save harmless learner preferences, tasks, and bookmarks locally. Never store credentials in localStorage. Dates shown in the seeded demo use October 2026.
- Keep navigation and state transitions predictable; provide explicit confirmation for destructive actions and helpful empty states.

## Validation
- Run `npm run build` after changes. `npm run dev` launches Vite and Electron; `npm run dev:web` runs only the renderer.
- Run `npm test` for the main journeys and security smoke checks. Check all six screens, both themes, keyboard dialogs, and narrow layouts.
- Update README when commands or architecture change. Do not add real integrations without explicit scope.
