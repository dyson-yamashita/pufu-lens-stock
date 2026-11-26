import { z } from 'zod';

export const footprintIntervals = [1, 3, 5, 10] as const;
export const footprintIntervalSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(5),
  z.literal(10),
]);
export type FootprintInterval = z.infer<typeof footprintIntervalSchema>;

export const footprintKinds = [
  'beginning',
  'discovery',
  'deepening',
  'expansion',
  'integration',
  'shift',
  'convergence',
  'resurgence',
  'pause',
  'continuing',
] as const;

const evidenceRef = z.number().int().positive();
const paragraph = z.string().trim().max(700);
export const footprintAnalysisSchema = z.object({
  kind: z.enum(footprintKinds),
  title: z.string().trim().min(1).max(140),
  before: paragraph,
  triggers: z
    .array(z.object({ text: paragraph.min(1), evidence: z.array(evidenceRef).min(1).max(5) }))
    .max(6),
  process: paragraph,
  current: paragraph,
  meaning: paragraph,
  unchanged: paragraph,
  perspectives: z.object({
    interests: paragraph,
    knowledge: paragraph,
    questions: paragraph,
    assumptions: paragraph,
    purpose: paragraph,
    strategy: paragraph,
    action: paragraph,
    environment: paragraph,
  }),
  evidence: z.array(evidenceRef).max(20),
});
export type FootprintAnalysis = z.infer<typeof footprintAnalysisSchema>;
export type FootprintEvidence = { kind: 'stock' | 'question' | 'pufu'; id: string; label: string };
export type FootprintPoint = {
  revision: number;
  end_at: string;
  kind: FootprintAnalysis['kind'];
};
export type FootprintDetail = FootprintPoint & {
  start_at: string;
  analysis: Omit<FootprintAnalysis, 'evidence' | 'triggers'> & { triggers: string[] };
  links: FootprintEvidence[];
};

export const footprintPublicationTitleLimit = 140;
export const footprintPublicationSummaryLimit = 1000;
export const footprintPublicationSchema = z.strictObject({
  title: z.string().trim().min(1).max(footprintPublicationTitleLimit),
  summary: z.string().trim().min(1).max(footprintPublicationSummaryLimit),
});
export type FootprintPublication = z.infer<typeof footprintPublicationSchema>;
export type OwnedFootprintDetail = FootprintDetail & {
  publication_enabled: boolean;
  publication: FootprintPublication | null;
};
export type PublicFootprint = FootprintPublication &
  Pick<FootprintDetail, 'kind' | 'start_at' | 'end_at'> & { id: string };
export type PublicFootprintPage = { items: PublicFootprint[]; page: number; has_more: boolean };
