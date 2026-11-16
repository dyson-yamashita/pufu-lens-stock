import type { Memory, MemoryCoverage } from '../../../shared/domain';

export type MemoryResponse = {
  memory: Memory | null;
  pending: boolean;
  error: string | null;
  coverage?: MemoryCoverage;
};
