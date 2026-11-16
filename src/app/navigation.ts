export type Route = {
  view:
    | 'stocks'
    | 'stock'
    | 'memory'
    | 'shortcuts'
    | 'mcp'
    | 'sns'
    | 'announcements'
    | 'profile'
    | 'questions'
    | 'pufus'
    | 'settings'
    | 'question'
    | 'resolve'
    | 'pufu';
  projectId: string | null;
  detailId?: string;
};

export type QuestionListContext = {
  view: 'questions' | 'pufus';
  projectId: string | null;
  scope: string | null;
  hash: string;
  scroll: number;
};

export function questionListContextFromHistory(): QuestionListContext {
  const value = window.history?.state?.questionListContext;
  return value &&
    (value.view === 'questions' || value.view === 'pufus') &&
    (value.projectId === null || typeof value.projectId === 'string') &&
    (value.scope === null || typeof value.scope === 'string') &&
    typeof value.hash === 'string' &&
    value.hash.startsWith('#') &&
    typeof value.scroll === 'number' &&
    Number.isFinite(value.scroll)
    ? value
    : { view: 'questions', projectId: null, scope: null, hash: '#questions', scroll: 0 };
}

export type StockOrigin = {
  hash: string;
  projectId: string | null;
  scope: string | null;
  scroll: number;
  tab: 'summary' | 'question';
};

export function stockOriginFromHistory(): StockOrigin {
  const value = window.history?.state?.stockOrigin;
  return value &&
    typeof value.hash === 'string' &&
    value.hash.startsWith('#') &&
    (value.projectId === null || typeof value.projectId === 'string') &&
    (value.scope === null || typeof value.scope === 'string') &&
    typeof value.scroll === 'number' &&
    Number.isFinite(value.scroll) &&
    (value.tab === 'summary' || value.tab === 'question')
    ? value
    : { hash: '#', projectId: null, scope: null, scroll: 0, tab: 'summary' };
}

export type PufuSource = {
  questionId: string | null;
  projectId: string | null;
};

export function pufuSourceFromHistory(): PufuSource {
  const source = window.history?.state?.pufuSource;
  return source &&
    (source.questionId === null || typeof source.questionId === 'string') &&
    (source.projectId === null || typeof source.projectId === 'string')
    ? { questionId: source.questionId, projectId: source.projectId }
    : { questionId: null, projectId: null };
}

export function routeFromHash(): Route {
  const [view, id] = window.location.hash.slice(1).split('/');
  return {
    view:
      view === 'memory' ||
      view === 'shortcuts' ||
      view === 'mcp' ||
      view === 'sns' ||
      view === 'announcements' ||
      view === 'profile' ||
      view === 'questions' ||
      view === 'pufus' ||
      ((view === 'question' || view === 'resolve' || view === 'pufu' || view === 'stock') &&
        !!id) ||
      (view === 'settings' && !!id)
        ? view
        : 'stocks',
    projectId:
      (view === 'project' ||
        view === 'memory' ||
        view === 'questions' ||
        view === 'pufus' ||
        view === 'settings') &&
      id
        ? decodeURIComponent(id)
        : null,
    detailId:
      (view === 'announcements' ||
        view === 'question' ||
        view === 'resolve' ||
        view === 'pufu' ||
        view === 'stock') &&
      id
        ? decodeURIComponent(id)
        : undefined,
  };
}
