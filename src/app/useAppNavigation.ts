import { useCallback, useEffect, useRef, useState } from 'react';
import type { Stock } from '../../shared/domain';
import type { PufuSource, QuestionListContext, Route, StockOrigin } from './navigation';
import {
  pufuSourceFromHistory,
  questionListContextFromHistory,
  routeFromHash,
  stockOriginFromHistory,
} from './navigation';
type Options = {
  resetPage: () => void;
  resetFilters: () => void;
  closeNavigation: () => void;
  closeModal: () => void;
};
export function useAppNavigation({
  resetPage,
  resetFilters,
  closeNavigation,
  closeModal,
}: Options) {
  const [route, setRoute] = useState<Route>(routeFromHash);

  const [stockOrigin, setStockOrigin] = useState<StockOrigin>(stockOriginFromHistory);

  const [openedStock, setOpenedStock] = useState<Stock | null>(null);

  const [stockError, setStockError] = useState('');

  const stockReturnScroll = useRef<number | null>(null);

  const stockOriginRef = useRef(stockOrigin);

  useEffect(() => {
    stockOriginRef.current = stockOrigin;
  }, [stockOrigin]);

  const [pufuSource, setPufuSource] = useState<PufuSource>(pufuSourceFromHistory);

  const [questionListContext, setQuestionListContext] = useState<QuestionListContext>(
    questionListContextFromHistory,
  );

  const navigationGuard = useRef<(() => boolean) | null>(null);

  const previousHash = useRef(window.location.hash);

  const previousHistoryState = useRef(window.history?.state);

  const setNavigationGuard = useCallback((guard: (() => boolean) | null) => {
    navigationGuard.current = guard;
  }, []);

  const [libraryProjectId, setLibraryProjectId] = useState<string | null>(null);

  const questionFlow =
    route.view === 'question' || route.view === 'resolve' || route.view === 'pufu';

  const stockFlow = route.view === 'stock';

  const detailFlow = questionFlow || stockFlow;

  const globalQuestionFlow = questionFlow && !questionListContext.projectId;

  const allQuestionsActive =
    (route.view === 'questions' && !route.projectId) ||
    (globalQuestionFlow && questionListContext.view === 'questions');

  const allPufusActive =
    (route.view === 'pufus' && !route.projectId) ||
    (globalQuestionFlow && questionListContext.view === 'pufus');

  const libraryView =
    !route.projectId &&
    (route.view === 'stocks' || route.view === 'questions' || route.view === 'pufus');

  const listProjectId = stockFlow
    ? stockOrigin.scope
    : (route.projectId ?? (libraryView ? libraryProjectId : null));

  const filterProject = (projectId: string | null) => {
    setLibraryProjectId(projectId);
    resetPage();
  };

  const navigateDetail = (view: 'question' | 'resolve' | 'pufu', id: string) => {
    window.location.hash = id ? `${view}/${encodeURIComponent(id)}` : questionListContext.hash;
    if (view === 'pufu') {
      const fromQuestion = route.view === 'question' || route.view === 'resolve';
      window.history.replaceState(
        {
          ...window.history.state,
          pufuSource: {
            questionId: fromQuestion ? route.detailId! : null,
            projectId: fromQuestion ? questionListContext.projectId : route.projectId,
          } satisfies PufuSource,
        },
        '',
      );
    }
    closeModal();
    closeNavigation();
  };

  const openQuestion = (id: string) => {
    if (!questionFlow && !(stockFlow && /^#(?:question|resolve|pufu)\//.test(stockOrigin.hash)))
      setQuestionListContext({
        view: 'questions',
        projectId: stockFlow ? stockOrigin.projectId : route.projectId,
        scope: listProjectId,
        hash:
          stockFlow && stockOrigin.hash.startsWith('#questions')
            ? stockOrigin.hash
            : route.view === 'questions'
              ? window.location.hash
              : `#questions${(stockFlow ? stockOrigin.projectId : route.projectId) ? `/${encodeURIComponent((stockFlow ? stockOrigin.projectId : route.projectId)!)}` : ''}`,
        scroll:
          stockFlow && stockOrigin.hash.startsWith('#questions')
            ? stockOrigin.scroll
            : route.view === 'questions'
              ? window.scrollY
              : 0,
      });
    navigateDetail('question', id);
  };

  const openStock = (stock: Stock, tab: StockOrigin['tab'] = 'summary') => {
    const origin: StockOrigin = {
      hash: window.location.hash || '#',
      projectId: questionFlow ? questionListContext.projectId : route.projectId,
      scope: questionFlow ? questionListContext.scope : listProjectId,
      scroll: window.scrollY,
      tab,
    };
    setStockOrigin(origin);
    setOpenedStock(stock);
    setStockError('');
    stockOriginRef.current = origin;
    window.history.pushState(
      { ...window.history.state, stockOrigin: origin, questionListContext },
      '',
      `#stock/${encodeURIComponent(stock.id)}`,
    );
    window.dispatchEvent(new window.Event('hashchange'));
    closeModal();
    closeNavigation();
  };

  const backFromStock = () => {
    stockReturnScroll.current = stockOrigin.scroll;
    window.history.pushState(
      { ...window.history.state, questionListContext },
      '',
      stockOrigin.hash,
    );
    window.dispatchEvent(new window.Event('hashchange'));
  };

  const openPufu = (id: string) => {
    setQuestionListContext({
      view: 'pufus',
      projectId: route.projectId,
      scope: listProjectId,
      hash: `#pufus${route.projectId ? `/${encodeURIComponent(route.projectId)}` : ''}`,
      scroll: window.scrollY,
    });
    navigateDetail('pufu', id);
  };

  const navigate = (view: Route['view'], projectId: string | null = null) => {
    window.location.hash =
      view === 'stocks'
        ? projectId
          ? `project/${encodeURIComponent(projectId)}`
          : ''
        : `${view}${projectId ? `/${encodeURIComponent(projectId)}` : ''}`;
    closeNavigation();
    resetFilters();
  };

  useEffect(() => {
    const listener = (event: Event) => {
      if (event.type === 'hashchange' && window.location.hash === previousHash.current) return;
      if (navigationGuard.current && !navigationGuard.current()) {
        window.history.replaceState(
          previousHistoryState.current,
          '',
          `${window.location.pathname}${window.location.search}${previousHash.current}`,
        );
        return;
      }
      const leavingStock = previousHash.current.startsWith('#stock/');
      if (!leavingStock) stockReturnScroll.current = null;
      previousHash.current = window.location.hash;
      previousHistoryState.current = window.history?.state;
      const nextRoute = routeFromHash();
      if (nextRoute.view === 'pufu') setPufuSource(pufuSourceFromHistory());
      if (nextRoute.view === 'stock') setStockOrigin(stockOriginFromHistory());
      if (leavingStock && (window.location.hash || '#') === stockOriginRef.current.hash) {
        stockReturnScroll.current = stockOriginRef.current.scroll;
        setLibraryProjectId(stockOriginRef.current.scope);
      }
      setRoute(nextRoute);
      if (nextRoute.view !== 'stock' && !leavingStock) resetPage();
    };
    window.addEventListener('hashchange', listener);
    window.addEventListener('popstate', listener);
    return () => {
      window.removeEventListener('hashchange', listener);
      window.removeEventListener('popstate', listener);
    };
  }, []);

  const restoreStockScroll = useCallback(() => {
    const scroll = stockReturnScroll.current;
    if (scroll === null) return;
    stockReturnScroll.current = null;
    window.requestAnimationFrame(() => window.scrollTo(0, scroll));
  }, []);

  useEffect(() => {
    if (detailFlow) window.scrollTo(0, 0);
    if (stockReturnScroll.current !== null && !stockFlow) {
      // A question page must finish loading before its previous scroll position fits.
      if (route.view !== 'question' && route.view !== 'resolve') restoreStockScroll();
    } else if (!detailFlow && route.view === questionListContext.view)
      window.requestAnimationFrame(() => window.scrollTo(0, questionListContext.scroll));
  }, [
    route.view,
    route.detailId,
    detailFlow,
    stockFlow,
    questionListContext.scroll,
    questionListContext.view,
    restoreStockScroll,
  ]);
  return {
    route,
    stockOrigin,
    openedStock,
    setOpenedStock,
    stockError,
    setStockError,
    pufuSource,
    questionListContext,
    libraryProjectId,
    questionFlow,
    stockFlow,
    detailFlow,
    allQuestionsActive,
    allPufusActive,
    libraryView,
    listProjectId,
    filterProject,
    navigateDetail,
    openQuestion,
    openStock,
    backFromStock,
    openPufu,
    navigate,
    restoreStockScroll,
    setNavigationGuard,
  };
}
