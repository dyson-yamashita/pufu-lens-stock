// Keep the source scoped to user-facing skills, excluding .agents/skills used for development.
export const skillsSourceUrl =
  'https://github.com/dyson-yamashita/pufu-lens-stock/tree/main/skills';
export const deepenQuestionsInstallCommand = `npx skills add ${skillsSourceUrl} --skill deepen-questions -g`;
export const composePufuInstallCommand = `npx skills add ${skillsSourceUrl} --skill compose-pufu -g`;
