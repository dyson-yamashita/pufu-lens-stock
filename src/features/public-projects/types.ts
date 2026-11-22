import type { PublicViewTotals } from '../../../shared/public-project';

export type PublicListProps = {
  root: string;
  page: number;
  onPageChange: (page: number) => void;
};

export const publicViewLabels = {
  project: 'ui.public_projects.project_page',
  stocks: 'ui.public_projects.stock_details',
  questions: 'ui.public_projects.question_or_insight_details',
  pufus: 'ui.public_projects.pufu_details',
} as const satisfies Record<keyof PublicViewTotals, string>;
