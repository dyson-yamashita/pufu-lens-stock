# Pufu Lens language support

## Accepted behavior

Support Japanese and English initially, with a registry and translation catalogs that allow further languages. Before login, use the browser's primary language (Japanese variants → Japanese, otherwise English), respecting a prior explicit local choice. At first login provide a native select for 日本語 / English, initially matching that choice. Persist the selection on the account; account language takes precedence across devices, Web and authenticated MCP. Existing accounts retain Japanese. Let the profile change the language later.

Translate application-owned navigation, forms, validation and failure guidance, the landing page, onboarding, help and public project chrome. Preserve names, user input, source excerpts and every previously saved score, phase, UUID and comment exactly. Changing language changes future generation, not existing artifacts. Keep public URLs, MCP names and JSON keys stable.

Use the account's language for newly requested article summaries, questions, memories and pufu proposals. Snapshot language atomically when queuing work so changing the account while work is pending cannot change an accepted request. Ensure memory refresh in another language rebuilds rather than merging differently localized generated prose. Do not add AI calls to language-setting or read operations.

Localize MCP instructions, tool metadata/input descriptions, guidelines, application errors and the embedded viewer. Raw get_pufu and all read data remain unchanged. All authorization, revision/request-id semantics and signed-image TTL/revocation remain intact. MCP is rebuilt per authenticated request, never a process-global language singleton.

Pufu Editor 0.9.19 accepts ja/en. Supply its explicit lang independently of the app i18n instance. Localize SVG/PNG headers and accessible descriptions without mutating ProjectScoreModel. Expose renderer label configuration and locale-aware English word wrapping; future fonts/editor capabilities must be explicitly supported before enabling a language.

## Implementation decisions

Use the existing i18next packages with an app-owned isolated instance (the Editor imports its own global i18next). A shared BCP-47 language registry owns display names, Intl locale/direction, output-language prompt and Editor mapping. Translation catalogs use application message identifiers and interpolation, not DOM rewriting, remote translation, or concatenation of user data into translation keys. Add SQL TEXT language columns with API validation from the registry, rather than one column per language or an enum migration for every additional language. Existing client requests omitting language retain existing stored language / Japanese onboarding defaults.

The only application settings source of truth after login is the account. Local preference is a convenience for anonymous pages and initial selection; failures to access localStorage must not block startup. Unsupported/malformed values fall back predictably; API writes reject unsupported language values. Set document lang/direction, localized dates/counts, loading animation text and page metadata. Legal text translations must identify the governing original without changing the existing consent versions or claims.

## Verification

Behavioral tests cover browser/account precedence, onboarding/profile persistence and validation, per-user/MCP isolation, job language snapshot including later async question jobs, memory language mismatch, AI prompt language and fallback templates, immutable reads, translated SVG/PNG and wrapping, and English application navigation. Extend the existing E2E ledger with the language choice/reload/settings flow and run the unchanged Japanese flows. Preserve strict AI-free CI recording rules and never edit recordings by hand. Run typecheck, lint, formatting, full Vitest and build. Perform standard scoped security audit and independent same-model review before PR; no merge/deployment.
