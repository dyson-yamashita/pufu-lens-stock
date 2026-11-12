export type UsagePeriod = 'week' | 'month' | 'all';
export type UsageCounts = {
  stocks: number;
  questions: number;
  pufus: number;
  ai_calls: number;
};
export type ProfileUsage = {
  timezone: 'Asia/Tokyo';
  as_of: string;
  periods: Record<UsagePeriod, UsageCounts & { since: string | null }>;
};
