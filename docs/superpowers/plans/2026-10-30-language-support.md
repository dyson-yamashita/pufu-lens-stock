# Pufu Lens language support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make anonymous and authenticated Pufu Lens usable in English while retaining Japanese and allowing more languages.

**Architecture:** Registry-backed language selection persisted on the account, immutable language snapshots on async jobs, and explicit per-request/renderer localization. Use isolated app i18next and explicit Editor language; never translate stored user documents on read.

**Tech Stack:** Existing React 19, i18next, Hono, D1, Workers AI, Vitest, E2E SDK.

**Spec:** docs/superpowers/specs/2026-10-30-language-support-design.md

## Global Constraints

- Japanese and English initially; browser primary Japanese variants → ja, otherwise en; saved account wins after login; existing accounts default ja.
- Initial onboarding select and later profile selection, values validated from one extensible registry.
- All previous user content/ProjectScoreModel/UUID/order preserved. No AI calls on settings changes or reads.
- New generation uses request-time language snapshots, including delayed child jobs; no language mixing in memory updates.
- MCP tool names/JSON keys/auth/scoping/request_id/revisions remain compatible. Signed images keep 3600-second TTL and revocation.
- No dependencies, DOM rewriting, global per-user language state, recording edits, weaker assertions or CI AI fallback.
- Native app i18next is isolated from Editor; Editor remains 0.9.19 with explicit lang.

## Review Focus

- Changing profile language while article/child question/memory generation is queued must not change the accepted job's language.
- Two users' concurrent MCP calls cannot inherit each other's locale; untrusted source text cannot choose a generation language.
- Existing API writes omitting language preserve it; unknown languages fail before DB mutation; old schema migrations remain tested.
- English SVG wrapping preserves complete words/text, accents, long URLs and comments; headers never alter the saved score.
- Storage unavailable and remounts must not crash; saved account language beats browser/local preference; no hydration flash overriding the user.

### Task 1: Shared language registry, account persistence and generation snapshots

**Files:** Create shared/locale.ts, shared/locales/* as needed, migrations/0036_language.sql, tests/language.test.ts, tests/language-generation.test.ts. Modify shared/domain.ts, server/auth.ts, server/env.ts, server/db.ts, server/api.ts, server/demo.ts, server/ai.ts, server/pufu.ts, server/workflows.ts, server/memory.ts and tests/helpers.ts / directly affected tests.

**Interfaces:** Produce `Language = keyof typeof languages`, `languages`, `defaultLanguage = 'ja'`, `fallbackLanguage = 'en'`, `resolveLanguage(value: unknown, fallback?: Language): Language`, `browserLanguage(value: unknown): Language` (primary only), `languageSchema`, and `translate(language: Language, message: string, values?: Record<string,string|number>): string` with independent message catalogs. Registry entries own `name`, `intlLocale`, `direction`, `generationInstruction`, `editorLanguage`. Unknown catalog keys return the passed message (English catalog coverage is enforced for used messages). User.language is present in production but optional in TypeScript for legacy fixture compatibility; consumers use resolveLanguage. Job.language snapshots are concrete in DB and optional in type for legacy fixtures.

- [ ] Add failing tests for onboarding/profile save, unsupported language rejection/omission compatibility/account isolation, AI language selection and job snapshot after changing profile.
- [ ] Run focused tests and record RED evidence.
- [ ] Implement registry, additive migrations (users/jobs plus memory language metadata if needed), auth projections, onboarding/profile persistence and job enqueue snapshots. Prefer one tested insert trigger over copying snapshot rules across all SQL enqueuers; child question jobs inherit the parent article job language.
- [ ] Thread optional final language parameters through AI entry points; generate output in the selected language, localize fallback templates and generated memory headings. Ensure short Japanese source text in English generation does not silently bypass requested output language when real AI is available. Rebuild memory in another language on the next requested update, without regenerating anything on settings save.
- [ ] Run related tests, typecheck, full suite once, self-review and commit only owned files. Report interfaces/tests/concerns.

### Task 2: MCP metadata, guidelines and pufu rendering

**Files:** server/mcp.ts, server/mcp-oauth.ts, shared/mcp.ts, server/pufu-guideline.ts, server/pufu-viewer.ts, server/pufu-renderer.ts, server/pufu-images.ts, server/pufu-image-links.ts as needed; src/mcp-pufu-viewer/_; shared/pufu-viewer.ts; shared/locales/mcp-_; packages/pufu-image/src/{svg,png,index}.ts; tests/mcp*.test.ts, tests/pufu-image*.test.ts.

**Interfaces:** Consume Task 1 shared/locale exports. Add shared/pufu-image-labels.ts supplying renderer labels by Language. Renderer `SvgOptions` accepts an optional complete labels object and language string while preserving Japanese defaults. `generateQuestionPufuImage` and MCP read functions use the current principal language for presentation only. Viewer structured content adds optional language; existing required fields unchanged.

- [ ] Write failing tests for two principals' differently localized MCP catalogs/guidelines, preserved tool/JSON identities, immutable score reads, English headers and complete word wrapping.
- [ ] Implement server translator per authenticated request, including schema descriptions, instructions, MCP errors and the authenticated OAuth consent page; avoid global mutation. Explicitly tell external AI the account output language for new content while preserving read data. Consent scope IDs/decisions/CSRF/escaping stay unchanged. Translate guidelines into a matching English static catalog preserving key structure/source attribution.
- [ ] Render localized headings/descriptions and English word boundaries, preserve graphemes/comments/model, thread language through PNG/image links and viewer; preserve signed-image behavior.
- [ ] Run focused tests, full suite once and typecheck; self-review and commit owned files.

### Task 3: Application English UI and language controls

**Files:** src/i18n.ts, src/LanguageSelect.tsx, src/locales/_, src/main.tsx, src/_.tsx (except mcp-pufu-viewer), src/api.ts, src/pufu-download.ts, index.html, scripts/legal-pages-plugin.ts; shared/locales/ui-* if useful; tests/language-ui.test.ts / affected UI tests; src/UserManual.tsx and English manual/legal copy. Legal build output removes the SPA module script: generate static English `/en/privacy` and `/en/terms` alongside original Japanese routes, and localized legal links must point to the correct static route. Do not rely on client-only locale switching for static legal pages.

**Interfaces:** Consume shared/locale exports and Task 2 pufu image labels/options. Export `t(message: string, values?: Record<string,string|number>): string`, `useLanguage(): {language: Language; setLanguage(language: Language):void}`, `setLanguage(language: Language): void`, and pure safe browser/local preference initialization; root setup must also work when tests import App directly. App synchronizes account language after identity fetch and on profile/onboarding save before rendering authenticated content. Isolate i18next via createInstance.

- [ ] Add meaningful failing UI tests for English landing by non-Japanese browser, Japanese browser, onboarding selection persistence, account override and later profile change; assertions cover real controls/navigation rather than dictionary internals.
- [ ] Implement language provider/subscription and selector. Translate application-owned labels/messages including landing/menu/settings/dialogs/public pages/manual/legal/help/boot animation, dates/counts/accessibility and API feedback. Never translate user/source content or build translation keys from it. Use explicit interpolation for dynamic text. No DOM scanning/MutationObserver/remote machine translation.
- [ ] Provide English typing animation without kana conversion and preserve existing Japanese animation. Add explicit Editor lang and locale-dependent image options/downloads. Update manual with initial language choice/later change/future generation only.
- [ ] Run relevant UI tests, typecheck, lint/format and full suite once. Self-review and commit owned files.

### Task 4: Integration, browser E2E, audit and delivery

**Files:** packages/e2e/scenarios.json, packages/e2e/scenarios/_, associated runner/check helpers where necessary; docs/SPEC.md or focused language-extension developer documentation; tests/language_.test.ts if integration gaps found.

- [ ] Review cross-task propagation and catalog coverage. Add E2E for language selection → saved English UI → reload → change Japanese, in desktop/phone, keeping all existing assertions and strict AI-free CI replay. Record through SDK only; no hand edits.
- [ ] Run e2e:check, relevant CI replay, full Vitest, types, lint, format, build, dependency audit. Record real browser coverage and any unavailable environment.
- [ ] Run standard scoped security audit and independent same-model requesting-code-review against complete diff; address findings and re-review fixes.
- [ ] Commit and push, create PR against main, attach it, wait for CI, report results/limitations. Do not merge/deploy.

### Task 5: Browser-selected documentation (user follow-up)

**Files:** server/legal-language.ts, server/index.ts, wrangler.jsonc, scripts/e2e/runtime.ts; src/LegalPage.tsx, PageLanguage.tsx, i18n.ts, main.tsx and locale copy; tests/legal-language.test.ts, manual-language-entry.test.ts and affected legal/UI tests.

- [ ] Add failing HTTP tests for canonical English/French/Japanese language selection, preference weights, unknown explicit values, no-store/Vary, anonymous Japanese body, HEAD and forced-original no-loop behavior.
- [ ] Route canonical GET/HEAD before auth to fixed same-origin locale paths or Japanese asset binding; configure Worker-first canonical legal paths and use the built asset routing in the disposable E2E runtime.
- [ ] Make production manual entry browser-only, preserve original and static explicit links, keep initial fallback HTML canonical. Add actual entry/HTML regressions.
- [ ] Run related RED→GREEN, then include in complete integration tests/build/review/scoped audit before delivery.
