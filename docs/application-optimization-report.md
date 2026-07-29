# Application optimization report

Date: 2026-07-20  
Branch: `07-19-polish`  
Scope: every user-facing route, role workspace, responsive input mode, navigation state, and critical content-request journey.

## Outcome

The application now uses the FairLend workspace's cream, evergreen, and lime visual system across authentication, operator, founder, administrator, error, and public-share surfaces. Route changes provide immediate visual feedback, server data is no longer redundantly loaded at nested route boundaries, the founder editor is isolated from non-founder route bundles, generated Markdown is rendered semantically, and the full audited surface is free of detected WCAG violations and horizontal overflow at the tested mobile and desktop viewports.

| Before                                                                                                                       | After                                                                                                                                                                                                                           | Why                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Nested `/app` routes repeated session/authentication loading.                                                                | `/app` authenticates once in `beforeLoad`; descendants consume `workspaceSession` from route context, while independent loader work runs concurrently.                                                                          | Removes a serialized server round trip from common route changes and keeps authorization at the boundary.                                    |
| Route changes could appear inert for 130–172 ms in the local baseline.                                                       | Intent preloading, shared pending/error UI, immediate progress feedback, and app-only view transitions provide visible feedback in 0–19 ms; measured warm completion is 19 ms mobile and 132 ms desktop.                        | Meets the under-100-ms feedback contract without animating public/auth boundaries or masking slow states.                                    |
| The request-detail route eagerly shipped 4,989,102 B raw / 1,766,531 B gzip of JavaScript to every role.                     | Request detail is 98,350 B raw / 30,880 B gzip; the founder canvas is lazy (251,880 B raw / 77,900 B gzip) and Automerge is a deferred 3,380,509 B WASM asset.                                                                  | Operator and agent users no longer pay for the collaborative editor; founder-only code loads at the role boundary.                           |
| Total executable client assets were 5,755,929 B raw / 1,983,680 B gzip.                                                      | Executable assets are 1,292,566 B raw / 380,913 B gzip. Including deferred WASM, the complete client graph is 4,673,075 B raw / 1,501,932 B gzip.                                                                               | Reduces executable transfer by 77.5% raw / 80.8% gzip and the complete graph by 18.8% raw / 24.3% gzip.                                      |
| Automerge used an embedded runtime on the request route and server validation errors were opaque in the E2E runtime.         | Browser bundling uses Automerge's bundler entry; Workerd uses its statically compiled WASM entry; Convex uses the package runtime condition. The canonical offline-save/reconnect/submit journey passes in WebKit and Chromium. | Preserves the Automerge document protocol while avoiding dynamic WASM compilation in Workerd and keeping correctness under offline recovery. |
| Promotion to Elie could fail with “A response draft is required.”                                                            | Promotion seeds the primary candidate from a prepared scout draft when present and still routes the opportunity, formats, and required destination when no draft exists.                                                        | Assignment and workflow routing are valid independently of draft availability; the reported blocker is removed.                              |
| Operator detail was a long generic record page with high-frequency controls mixed with archival and delivery administration. | It is a triage inbox with queue rail, assessment, explicit route action, content-format selection, mobile action bar, and `Record options & delivery` progressive disclosure.                                                   | Prioritizes the operator's actual decision while retaining every administrative control.                                                     |
| Mobile filter controls consumed most of the first viewport and could obscure the library.                                    | Search and action queues remain primary; advanced filters live in a labeled disclosure; the mobile `New request` action is always available.                                                                                    | Improves scan speed and preserves creation access in non-empty queues.                                                                       |
| Delivery was labeled “Responded” even before confirmation.                                                                   | The delivery heading derives `Delivery`, `Ready to respond`, or `Responded` from promoted versions and required receipts.                                                                                                       | Communicates the true operational state instead of a misleading static label.                                                                |
| Operator detail omitted durable founder status after the visual redesign.                                                    | Lifecycle and `Founder draft saved` badges are exposed without revealing private founder draft text.                                                                                                                            | Restores operational awareness while preserving role privacy.                                                                                |
| Voice mode used a small nested recording trigger and the editor could collide with controls at constrained heights.          | The complete voice-input surface is the `Press to record` button; type and record layouts reserve an unobstructed submit row and use dynamic viewport sizing.                                                                   | Produces a large, understandable target and prevents input-mode obstruction.                                                                 |
| Source and response bodies displayed Markdown syntax as plain text.                                                          | Shared `MarkdownContent` renders GFM headings, lists, emphasis, links, and code with controlled heading levels and readable measure.                                                                                            | Fixes raw Markdown leakage and creates accessible document structure.                                                                        |
| Context controls and cards had small hit areas, weak contrast, and inconsistent hierarchy.                                   | Pin/back/record targets are at least 44 px where tested; typography uses a system stack, consistent measure, larger control text, corrected destructive/disabled contrast, and responsive wrapping.                             | Improves WCAG 2.2 target size, contrast, zoom resilience, and content legibility.                                                            |
| The administrator mobile header overflowed when the workspace switcher, identity, and actions were all present.              | The switcher becomes an accessible icon action on narrow screens, the administrator avatar remains visible, and the redundant identity copy collapses.                                                                          | Keeps all actions reachable with zero document overflow.                                                                                     |
| Actions had no tactile acknowledgement.                                                                                      | Touch-initiated promote, pass, and snooze actions use optional reduced-motion-aware vibration patterns and safely no-op when unsupported.                                                                                       | Adds native-feeling acknowledgement without affecting keyboard/mouse users or unsupported browsers.                                          |
| Loading, not-found, and route-error presentation varied by page.                                                             | Shared route fallbacks, semantic status/alert regions, stable skeleton geometry, and reduced-motion behavior cover pending, retry, and failure states.                                                                          | Prevents blank transitions and gives assistive technology deliberate state changes.                                                          |

## Route and state audit

| Route / surface            | Roles and states verified                    | Result                                                                                                                                                     |
| -------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                        | Root redirect                                | Stable handoff to the application boundary.                                                                                                                |
| `/sign-in`                 | Public, loading-ready                        | Workspace styling, semantic landmark, no overflow or Axe findings.                                                                                         |
| `/unauthorized`            | Forbidden identity                           | Clear recovery actions, accessible contrast, no overflow or Axe findings.                                                                                  |
| Unknown route              | Public 404                                   | Shared not-found treatment and valid landmark structure.                                                                                                   |
| `/app`                     | Operator, founder/Elie, agent, administrator | Role-appropriate library, loading/empty/filter states, responsive list/stack/grid, administrator QA switch, preserved identity.                            |
| `/app/new`                 | Operator/editor                              | Required-field semantics, optional source fields, hydrated/disabled/submitting/error states, accessible contrast.                                          |
| `/app/requests/:requestId` | Operator/editor                              | Queue navigation, assessment, Markdown, promote/pass/snooze, format selection, assignment, archive/restore, delivery, sharing, attention/read-only states. |
| `/app/requests/:requestId` | Founder/Elie                                 | Context deck, pin/show/hide, type, full-surface record, expand, save/saving/offline/pending/blocked, history, submit, inactive read-only states.           |
| `/share/:token`            | Public                                       | Approved content only, revoked/not-found behavior, no private founder or candidate leakage.                                                                |
| `/logout`                  | Authenticated/offline cleanup                | Private offline cache/draft purge and recovery messaging.                                                                                                  |

API routes were not visually restyled, but their authorization and canonical workflow consumers were exercised by the E2E journeys.

## Performance evidence

All measurements are local lab measurements from the Playwright production-preview harness. They are useful for regression comparison, not a substitute for field RUM.

| Metric                                              |                Baseline |                                              Final |
| --------------------------------------------------- | ----------------------: | -------------------------------------------------: |
| Mobile warm visible navigation feedback             |                171.6 ms |                                              19 ms |
| Desktop warm visible navigation feedback            |                  130 ms | Immediate progress; destination complete at 132 ms |
| Mobile maximum route-visible time                   |                543.4 ms |                                           164.4 ms |
| Mobile maximum observed LCP                         |                1,753 ms |                                             576 ms |
| Maximum observed CLS                                |          0.0026 desktop |                                                  0 |
| Axe violations across canonical surfaces            |  11 mobile / 15 desktop |                                              0 / 0 |
| Maximum horizontal overflow                         |                    0 px |                                               0 px |
| Client executable graph (raw / gzip)                | 5,755,929 / 1,983,680 B |                              1,292,566 / 380,913 B |
| Complete graph including deferred WASM (raw / gzip) | 5,755,929 / 1,983,680 B |                            4,673,075 / 1,501,932 B |
| Request-detail JavaScript (raw / gzip)              | 4,989,102 / 1,766,531 B |                                  98,350 / 30,880 B |

Final artifacts:

- `docs/application-audit/final/mobile-webkit/metrics.json`
- `docs/application-audit/final/desktop-chromium/metrics.json`
- `docs/application-audit/final/mobile-webkit/*.png`
- `docs/application-audit/final/desktop-chromium/*.png`
- `docs/mockups/founder-record-accessible-{mobile,desktop}.png`
- `docs/mockups/triage-{mobile,desktop}-implementation.png`

## Material implementation files

- Routing and feedback: `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/app.tsx`, `src/components/navigation-feedback.tsx`, `src/components/route-fallback.tsx`
- Operator experience: `src/routes/app.index.tsx`, `src/routes/app.requests.$requestId.tsx`, `src/components/triage-inbox.tsx`, `src/components/opportunity-decision-panel.tsx`, `src/application/promote-opportunity.ts`
- Founder experience: `src/components/founder-request-canvas.tsx`, `src/components/unified-context-canvas.tsx`, `src/components/founder-voice-recorder.tsx`, `src/hooks/use-founder-automerge.ts`, `convex/founderInputs.ts`
- Content and accessibility: `src/components/markdown-content.tsx`, `src/typeset.css`, `src/index.css`, `src/components/ui/{button,badge,card}.tsx`
- Verification: `tests/e2e/application-quality.spec.ts`, `tests/e2e/foundation.spec.ts`, `tests/e2e/triage-inbox.spec.ts`, and the promotion, Markdown, haptics, button-semantics, opportunity, and canvas contract suites.

## Verification

| Check                                             | Result                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run typecheck`                               | Pass                                                                                                                                                                |
| `bun run lint`                                    | Pass                                                                                                                                                                |
| `bun run test`                                    | 51 files, 273 tests passed                                                                                                                                          |
| `bun run build`                                   | Pass; client and server production bundles generated                                                                                                                |
| Final application-quality audit, mobile WebKit    | Pass; 0 Axe, 0 overflow, 0 CLS                                                                                                                                      |
| Final application-quality audit, desktop Chromium | Pass; 0 Axe, 0 overflow, 0 CLS                                                                                                                                      |
| Foundation + triage journeys                      | 20 scenarios verified across both projects; the final combined run passed 18 and the two selector-disambiguated canonical journeys passed 2/2 immediately afterward |
| Canonical founder → agent → operator journey      | Pass in WebKit and Chromium, including durable Automerge save and response confirmation                                                                             |

## Constraints and rejected optimizations

- A custom slim Automerge runtime that fetched WASM bytes was rejected. Workerd forbids runtime WASM code generation, and the validation wrapper initially made that look like an invalid document. The final implementation uses Automerge's runtime-specific package exports and a statically compiled Workerd module instead.
- The 3.38 MB Automerge WASM remains necessary for founder collaborative editing. It is now deferred behind the founder-only route boundary, so operator, agent, administrator-operator, auth, error, and public-share routes do not execute it.
- Browser vibration availability is platform-dependent. Haptics are enhancement-only, touch-gated, reduced-motion-aware, and safely no-op when unavailable.
- Vite reports `INEFFECTIVE_DYNAMIC_IMPORT` for `convex/schema.ts` and `convex/lib/requestOrdering.ts` in the E2E-only Convex fallback. Those modules are also statically required by the in-memory test backend; the warning does not affect the production client split.
- Measurements are local production-preview lab data. Real-user monitoring should be used to validate network and device distributions after deployment.

## Sources used for implementation decisions

- TanStack Router preloading, data loading, pending components, and view-transition documentation.
- Convex runtime and bundling documentation for statically compiled WebAssembly modules.
- React guidance enforced by the repository lint rules and the installed React performance skill.
