import type { Project } from '../../shared/domain';

export type ModalState =
  | {
      type: 'project';
      project?: Project;
    }
  | {
      type: 'save';
    }
  | {
      type: 'token';
    }
  | {
      type: 'question';
      projectId?: string;
      stock?: { id: string; label: string };
    }
  | {
      type: 'pufu';
    }
  | {
      type: 'memory';
      projectId: string | null;
    }
  | null;
