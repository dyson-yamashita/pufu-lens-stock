// Match the app's branding, onboarding cards, and light/dark palette.
const dark = `
  color-scheme: dark;
  --primary: #81cff6;
  --button: #70c8f9;
  --button-hover: #97d9ff;
  --on-button: #15252d;
  --text: #e7f3fa;
  --muted: #adcadb;
  --border: #354d5c;
  --field-border: #7592a3;
  --card: #162630;
  --page: #101a22;
  --wash: #1e313e;
  --logo-light: none;
  --logo-dark: block;
`;

export const mcpConsentStyle = `
:root {
  color-scheme: light;
  --primary: #096c9e;
  --button: #0ea7ff;
  --button-hover: #0095e7;
  --on-button: #15252d;
  --text: #213746;
  --muted: #496477;
  --border: #d6e7ef;
  --field-border: #7893a5;
  --card: #fff;
  --page: #fcfeff;
  --wash: #edf8fd;
  --focus: var(--primary);
  --logo-light: block;
  --logo-dark: none;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
:root[data-theme="dark"] { ${dark} }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { ${dark} }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 28px 20px max(28px, env(safe-area-inset-bottom));
  font-family: 'DM Sans', 'Noto Sans JP', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  background: var(--page);
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  max-width: 600px;
  margin: 0 auto 24px;
}
.brand-lockup { display: inline-flex; align-items: center; gap: 10px; }
.brand-mark { display: block; width: 38px; height: 38px; border-radius: 11px; }
.brand-logo { width: 120px; height: auto; }
.brand-logo-light { display: var(--logo-light); }
.brand-logo-dark { display: var(--logo-dark); }
.page-label {
  margin: 0;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--muted);
  background: var(--wash);
  font-size: 12px;
  font-weight: 600;
}
main {
  max-width: 600px;
  margin: 0 auto;
  padding: clamp(20px, 5vw, 36px);
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--card);
}
h1 { margin: 0; font-size: clamp(22px, 5vw, 28px); line-height: 1.5; }
h1, p, .permission span { overflow-wrap: anywhere; }
.identity { margin: 12px 0 20px; color: var(--muted); }
.connection-details {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--wash);
  font-size: 12px;
}
.connection-details p { margin: 0; }
.connection-details p + p { margin-top: 4px; }
fieldset { min-width: 0; margin: 28px 0; padding: 0; border: 0; }
legend { width: 100%; margin-bottom: 12px; padding: 0; font-weight: 600; }
.permission {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
}
.permission + .permission { margin-top: 4px; }
.permission:hover, .permission:has(input:checked) { background: var(--wash); }
.project-access > .permission { border-color: var(--border); }
.project-access > .permission:has(input:checked) { border-color: var(--primary); }
.permission span { min-width: 0; }
input, button { font: inherit; }
input[type=checkbox], input[type=radio] {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  margin: 2px 0 0;
  accent-color: var(--primary);
  cursor: pointer;
}
small { display: block; margin-top: 12px; color: var(--muted); font-size: 12px; }
.project-options { margin-top: 12px; padding: 8px; border: 1px solid var(--border); border-radius: 12px; }
.project-access:has(input[value="all"]:checked) .project-options { display: none; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-top: 24px; border-top: 1px solid var(--border); }
.button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-height: 48px;
  padding: 11px 17px;
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.primary { background: var(--button); color: var(--on-button); }
.primary:hover:not(:disabled) { background: var(--button-hover); }
.secondary { background: var(--card); border-color: var(--field-border); color: var(--text); }
.secondary:hover { background: var(--wash); }
.selection-required { display: none; }
button:disabled { opacity: .52; cursor: not-allowed; }
form:has(input[name="project_access"][value="selected"]:checked):not(:has(input[name="project_id"]:checked)) .approve { display: none; }
form:has(input[name="project_access"][value="selected"]:checked):not(:has(input[name="project_id"]:checked)) .selection-required { display: block; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
@media (max-width: 360px) {
  body { padding-inline: 12px; }
  .actions { grid-template-columns: 1fr; }
}
`;
