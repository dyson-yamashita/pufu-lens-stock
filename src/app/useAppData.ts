import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Project, Stock, TokenInfo } from '../../shared/domain';
import type { useAppSession } from '../features/auth/useAppSession';
import type { MemoryResponse } from '../features/memory/types';
import type { ProjectSettings } from '../features/projects/ProjectForm';
import { applicationError } from '../i18n/i18n';
import { api, ApiError, send } from '../lib/api';
import type { useAppNavigation } from './useAppNavigation';
type Options = {
  session: ReturnType<typeof useAppSession>;
  navigation: ReturnType<typeof useAppNavigation>;
  filters: {
    search: string;
    stockSource: string;
    page: number;
    pageSize: number;
    setPage: Dispatch<SetStateAction<number>>;
  };
  setError: Dispatch<SetStateAction<string>>;
};
export function useAppData({ session, navigation, filters, setError }: Options) {
  const { user, setUser } = session;
  const {
    route,
    listProjectId,
    libraryProjectId,
    navigate,
    filterProject,
    openStock,
    setOpenedStock,
    setStockError,
  } = navigation;
  const { search, stockSource, page, pageSize, setPage } = filters;
  const [projects, setProjects] = useState<Project[]>([]);
  const projectMutationVersion = useRef(0);

  const [stocks, setStocks] = useState<Stock[]>([]);

  const [savingStockFavorites, setSavingStockFavorites] = useState<string[]>([]);

  const stockMutationVersion = useRef(0);

  const [memoryResponse, setMemoryResponse] = useState<MemoryResponse>({
    memory: null,
    pending: false,
    error: null,
  });

  const [tokens, setTokens] = useState<TokenInfo[]>([]);

  const [total, setTotal] = useState(0);

  const [refresh, setRefresh] = useState(0);

  const [loading, setLoading] = useState(true);

  const reload = () => setRefresh((value) => value + 1);

  const applyProjectSettings = (id: string, settings: ProjectSettings) => {
    projectMutationVersion.current++;
    setProjects((current) =>
      current.map((project) => (project.id === id ? { ...project, ...settings } : project)),
    );
  };

  useEffect(() => {
    if (!user?.onboarding_completed_at) return;
    const controller = new AbortController();
    setLoading(true);
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const version = stockMutationVersion.current;
      const projectVersion = projectMutationVersion.current;
      const params = new URLSearchParams({
        q: search,
        source: stockSource === 'favorites' ? 'all' : stockSource,
        page: String(page),
        limit: String(pageSize),
      });
      if (stockSource === 'favorites') params.set('favorite', 'true');
      if (listProjectId) params.set('project_id', listProjectId);
      try {
        const [projectData, stockData, memoryData, tokenData] = await Promise.all([
          api<{
            projects: Project[];
          }>('/api/v1/projects?include_reflections=true', { signal: controller.signal }),
          api<{
            stocks: Stock[];
            total: number;
          }>(`/api/v1/stocks?${params}`, {
            signal: controller.signal,
          }),
          api<MemoryResponse>(
            `/api/v1/memory${route.projectId ? `?project_id=${encodeURIComponent(route.projectId)}` : ''}`,
            { signal: controller.signal },
          ),
          route.view === 'shortcuts'
            ? api<{
                tokens: TokenInfo[];
              }>('/api/v1/tokens', { signal: controller.signal })
            : Promise.resolve({ tokens: [] }),
        ]);
        if (!controller.signal.aborted) {
          if (projectVersion === projectMutationVersion.current) setProjects(projectData.projects);
          if (version === stockMutationVersion.current) {
            setStocks(stockData.stocks);
            setTotal(stockData.total);
            if (page > 1 && page > Math.max(1, Math.ceil(stockData.total / pageSize)))
              setPage(Math.max(1, Math.ceil(stockData.total / pageSize)));
          }
          setMemoryResponse(memoryData);
          setTokens(tokenData.tokens);
          setError('');
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        if ((e as ApiError).status === 401) setUser(null);
        else if ((e as ApiError).status === 404 && route.projectId) navigate('stocks');
        else if ((e as ApiError).status === 404 && libraryProjectId) filterProject(null);
        else setError(applicationError((e as Error).message));
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [
    user,
    route.view,
    route.projectId,
    listProjectId,
    libraryProjectId,
    search,
    stockSource,
    page,
    pageSize,
    refresh,
  ]);

  useEffect(() => {
    if (!user?.onboarding_completed_at || route.view !== 'stock' || !route.detailId) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const version = stockMutationVersion.current;
      try {
        const { stock } = await api<{ stock: Stock }>(
          `/api/v1/stocks/${encodeURIComponent(route.detailId!)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted && version === stockMutationVersion.current) {
          setOpenedStock(stock);
          setStockError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          if ((error as ApiError).status === 401) setUser(null);
          if ([403, 404].includes((error as ApiError).status)) setOpenedStock(null);
          setStockError(applicationError((error as Error).message));
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [user, route.view, route.detailId, refresh]);

  const toggleStockFavorite = async (stock: Stock) => {
    stockMutationVersion.current += 1;
    setSavingStockFavorites((ids) => [...ids, stock.id]);
    setError('');
    try {
      const result = await send<Pick<Stock, 'id' | 'is_favorite'>>(
        `/api/v1/stocks/${encodeURIComponent(stock.id)}/favorite`,
        { is_favorite: !stock.is_favorite },
        'PATCH',
      );
      setStocks((items) =>
        items.map((item) =>
          item.id === result.id ? { ...item, is_favorite: result.is_favorite } : item,
        ),
      );
      setOpenedStock((current) =>
        current?.id === result.id ? { ...current, is_favorite: result.is_favorite } : current,
      );
    } finally {
      stockMutationVersion.current += 1;
      setSavingStockFavorites((ids) => ids.filter((id) => id !== stock.id));
      reload();
    }
  };

  const renameStock = async (stock: Stock, title: string) => {
    stockMutationVersion.current += 1;
    try {
      const result = await send<Pick<Stock, 'id' | 'title'>>(
        `/api/v1/stocks/${encodeURIComponent(stock.id)}/title`,
        { title },
        'PATCH',
      );
      setStocks((items) =>
        items.map((item) => (item.id === result.id ? { ...item, title: result.title } : item)),
      );
      setOpenedStock((current) =>
        current?.id === result.id ? { ...current, title: result.title } : current,
      );
    } finally {
      stockMutationVersion.current += 1;
      reload();
    }
  };

  const evidence = async (articleId: string) => {
    try {
      const { stock } = await api<{
        stock: Stock;
      }>(`/api/v1/articles/${encodeURIComponent(articleId)}`);
      openStock(stock);
    } catch (e) {
      setError(applicationError((e as Error).message));
    }
  };
  return {
    refresh,
    projects,
    applyProjectSettings,
    stocks,
    savingStockFavorites,
    memoryResponse,
    tokens,
    total,
    loading,
    reload,
    toggleStockFavorite,
    renameStock,
    evidence,
  };
}
