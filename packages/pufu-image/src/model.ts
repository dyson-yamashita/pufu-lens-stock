import { z } from 'zod';
const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const comment = z.strictObject({
  color: z.enum(['blue', 'green', 'red']),
  text: z.string().max(600),
});
const node = z.strictObject({ uuid: nodeId, text: z.string().max(1200), comment });
const measure = node.extend({
  id: nodeId.optional(),
  color: z.enum(['white', 'blue', 'green', 'red', 'yellow']),
  progress: z.number().min(0).max(100).optional(),
});
export const elementKeys = [
  'people',
  'money',
  'time',
  'quality',
  'businessScheme',
  'environment',
  'rival',
  'foreignEnemy',
] as const;
export const pufuScoreSchema = z
  .strictObject({
    gainingGoal: node,
    winCondition: node,
    purposes: z.array(node.extend({ measures: z.array(measure).max(12) })).max(12),
    elements: z.strictObject({
      people: node,
      money: node,
      time: node,
      quality: node,
      businessScheme: node,
      environment: node,
      rival: node,
      foreignEnemy: node,
    }),
  })
  .superRefine((score, ctx) => {
    const nodes = [
      score.gainingGoal,
      score.winCondition,
      ...Object.values(score.elements),
      ...score.purposes.flatMap((p) => [p, ...p.measures]),
    ];
    if (new Set(nodes.map((item) => item.uuid)).size !== nodes.length)
      ctx.addIssue({ code: 'custom', message: '要素のIDが重複しています。' });
  });
export type PufuScore = z.infer<typeof pufuScoreSchema>;
