import {
  applicationError,
  t,
  intlLocale,
  initializeLanguage,
  applyAccountLanguage,
  useLanguage,
  setLanguage as persistLanguage,
  homeHref,
  manualHref,
} from './i18n';
import LanguageSelect from './LanguageSelect';
import type { Language } from '../shared/locale';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  Folder,
  Globe,
  KeyRound,
  Layers,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Star,
  UserRound,
  X,
} from 'lucide-react';
import { BootMessage } from './BootMessage';
import type {
  Config,
  Memory,
  MemoryCoverage,
  Project,
  Stock,
  TokenInfo,
  User,
} from '../shared/domain';
import { stockInputSchema, stockTextLimit } from '../shared/domain';
import { isYouTubeUrl, youtubeDisplayTitle } from '../shared/youtube';
import YouTubePlayer from './YouTubePlayer';
import YouTubeThumbnail from './YouTubeThumbnail';
import { api, ApiError, createRequestId, send } from './api';
import Profile from './Profile';
import Onboarding from './Onboarding';
import Questions, { StockQuestion } from './Questions';
import QuestionForm from './QuestionForm';
import SearchField from './SearchField';
import QuestionPage from './QuestionPage';
import PufuPage from './PufuPage';
import PufuForm from './PufuForm';
import PufuModal from './PufuModal';
import Comments from './Comments';
import DeleteAction from './DeleteAction';
import Pufus from './Pufus';
import McpConnections from './McpConnections';
import MemoryRebuildForm from './MemoryRebuildForm';
import MemoryKnowledge from './MemoryKnowledge';
import ScrollHeader from './ScrollHeader';
import LegalLinks from './LegalLinks';
import { PublicProjectDirectory, ProjectPublicationSettings } from './PublicProjects';
import shortcutSetupImage from './assets/shortcut-setup.png';
type MemoryResponse = {
  memory: Memory | null;
  pending: boolean;
  error: string | null;
  coverage?: MemoryCoverage;
};
type Route = {
  view:
    | 'stocks'
    | 'memory'
    | 'shortcuts'
    | 'mcp'
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
type PufuSource = {
  questionId: string | null;
  projectId: string | null;
};
function pufuSourceFromHistory(): PufuSource {
  const source = window.history?.state?.pufuSource;
  return source &&
    (source.questionId === null || typeof source.questionId === 'string') &&
    (source.projectId === null || typeof source.projectId === 'string')
    ? { questionId: source.questionId, projectId: source.projectId }
    : { questionId: null, projectId: null };
}
const headerLabels = (): Record<Route['view'], string> => ({
  stocks: t('ui.app.stocks'),
  questions: t('ui.app.questions_insights'),
  pufus: t('ui.app.pufu'),
  memory: t('ui.app.memory'),
  settings: t('ui.app.settings'),
  profile: t('ui.app.profile'),
  mcp: t('ui.app.integrations'),
  shortcuts: t('ui.app.shortcuts'),
  question: t('ui.app.details'),
  resolve: t('ui.app.create_pufu'),
  pufu: t('ui.app.details'),
});
const globalHeaderLabels = (): Partial<Record<Route['view'], string>> => ({
  stocks: t('ui.app.all_stocks'),
  questions: t('ui.app.all_questions_insights'),
  pufus: t('ui.app.all_pufu'),
  memory: t('ui.app.your_memory'),
});
type ModalState =
  | {
      type: 'project';
      project?: Project;
    }
  | {
      type: 'save';
    }
  | {
      type: 'stock';
      stock: Stock;
      tab?: 'question';
    }
  | {
      type: 'token';
    }
  | {
      type: 'question';
    }
  | {
      type: 'pufu';
    }
  | {
      type: 'memory';
      projectId: string | null;
    }
  | null;
const statusLabels = () => ({
  queued: t('ui.app.queued'),
  extracting: t('ui.app.retrieving_article'),
  summarizing: t('ui.app.generating_summary'),
  ready: t('ui.app.summarized'),
  failed: t('ui.app.retrieval_failed'),
});
const date = (value: string) =>
  new Intl.DateTimeFormat(intlLocale(), {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
const fullDate = (value: string) =>
  new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
function routeFromHash(): Route {
  const [view, id] = window.location.hash.slice(1).split('/');
  return {
    view:
      view === 'memory' ||
      view === 'shortcuts' ||
      view === 'mcp' ||
      view === 'profile' ||
      view === 'questions' ||
      view === 'pufus' ||
      ((view === 'question' || view === 'resolve' || view === 'pufu') && !!id) ||
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
      (view === 'question' || view === 'resolve' || view === 'pufu') && id
        ? decodeURIComponent(id)
        : undefined,
  };
}
function Brand() {
  useLanguage();
  return (
    <a className="brand" href="#" aria-label={t('ui.app.pufu_lens_home')}>
      <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
      <span>Pufu Lens</span>
    </a>
  );
}
function Spinner() {
  useLanguage();
  return <LoaderCircle className="spin" size={17} aria-hidden="true" />;
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''}`}
      aria-labelledby={id}
      onCancel={onClose}
    >
      <div className="dialog-head">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label={t('ui.app.close')}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function FormError({ error }: { error: string }) {
  useLanguage();
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
function Login({ config, onLogin }: { config: Config; onLogin: () => Promise<void> }) {
  useLanguage();
  const { language } = useLanguage();
  const withdrawn = new URLSearchParams(window.location.search).get('withdrawn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    new URLSearchParams(window.location.search).has('login_error')
      ? t('ui.app.google_sign_in_could_not_be_completed_please_try')
      : '',
  );
  const onLanguageChange = (next: Language) => {
    persistLanguage(next);
    const target = homeHref(next);
    const current = window.location.pathname.replace(/\/$/, '') || '/';
    const normalized = target.replace(/\/$/, '') || '/';
    if (current !== normalized && typeof window.location.assign === 'function') {
      window.location.assign(target);
    }
  };
  return (
    <div className="login-page">
      <header>
        <Brand />
        <div className="login-header-links">
          <span className="login-caption">{t('ui.app.read_collect_connect')}</span>
          <a className="text-link" href={manualHref(language)}>
            <BookOpen size={17} aria-hidden="true" />
            {t('ui.app.manual')}
          </a>
          <LanguageSelect id="site-language" value={language} onChange={onLanguageChange} />
        </div>
      </header>
      <main className="login-main">
        <div className="login-copy">
          <h1>
            {t('ui.app.turn_collected_knowledge')}
            <br />
            {t('ui.app.into_connected')}
            <span>{t('ui.app.memory_2')}</span>
            {t('ui.app.separator')}
          </h1>
          <p>
            {t('ui.app.save_interesting_articles_to_projects')}
            <br />
            {t('ui.app.connect_their_key_points_with_your_interests')}
            <br />
            {t('ui.app.and_grow_them_into_a_shared_memory')}
          </p>
          <a
            className={`button primary google-button ${!config.googleConfigured ? 'disabled' : ''}`}
            href={config.googleConfigured ? '/api/auth/google' : undefined}
            aria-disabled={!config.googleConfigured}
          >
            <span className="google-g" aria-hidden="true">
              G
            </span>
            {t('ui.app.sign_in_with_google')}
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          {!config.googleConfigured && (
            <p className="login-help">
              {config.demo
                ? t('ui.app.try_the_app_with_the_local_demo')
                : t('ui.app.sign_in_is_being_prepared_please_contact_the_administrator')}
            </p>
          )}
          {config.demo && (
            <button
              className="button secondary demo-login"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await onLogin();
                } catch (e) {
                  setError(applicationError((e as Error).message));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : <BookOpen size={18} aria-hidden="true" />}
              {t('ui.app.open_local_demo')}
            </button>
          )}
          {['complete', 'pending'].includes(withdrawn ?? '') && (
            <p className="withdrawal-notice" role="status">
              {withdrawn === 'pending'
                ? config.demo
                  ? t('ui.app.your_account_was_deleted_remaining_demo_data_will_also')
                  : t('ui.app.your_account_was_deleted_remaining_data_will_continue_to')
                : t('ui.app.your_account_and_registered_data_have_been_deleted')}
            </p>
          )}
          <FormError error={error} />
        </div>
        <div className="login-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-tag">
            <Bookmark size={16} />
            {t('ui.app.find_connections_beyond_what_you_read')}
          </div>
          <div className="art-article">
            <h3>
              {t('ui.app.today_s_article')}
              <br />
              {t('ui.app.tomorrow_s_idea')}
            </h3>
            <div className="art-rule" />
            <div className="art-rule short" />
            <div className="art-tags">
              <span>{t('ui.app.interests')}</span>
              <span>{t('ui.app.fresh_perspectives')}</span>
            </div>
          </div>
          <div className="art-memory">
            <div className="art-memory-icon">
              <Sparkles size={21} />
            </div>
            <div>
              <h3>{t('ui.app.grow_your_interests_and_knowledge')}</h3>
              <p>{t('ui.app.organize_themes_and_questions_from_saved_articles')}</p>
            </div>
            <ArrowUpRight size={20} />
          </div>
        </div>
      </main>
      <section
        id="what-you-can-do"
        className="what-you-can-do"
        aria-labelledby="what-you-can-do-heading"
      >
        <h2 id="what-you-can-do-heading">{t('ui.app.what_you_can_do')}</h2>
        <div className="what-you-can-do-steps">
          <article className="what-you-can-do-card">
            <span className="what-you-can-do-number" aria-hidden="true">
              1
            </span>
            <h3>{t('ui.app.step_stock_title')}</h3>
            <p>{t('ui.app.step_stock_body')}</p>
          </article>
          <article className="what-you-can-do-card">
            <span className="what-you-can-do-number" aria-hidden="true">
              2
            </span>
            <h3>{t('ui.app.step_grow_title')}</h3>
            <p>{t('ui.app.step_grow_body')}</p>
          </article>
          <article className="what-you-can-do-card">
            <span className="what-you-can-do-number" aria-hidden="true">
              3
            </span>
            <h3>{t('ui.app.step_pufu_title')}</h3>
            <p>{t('ui.app.step_pufu_body')}</p>
          </article>
        </div>
        <p className="what-you-can-do-note">
          {t('ui.app.mcp_plain_note')}{' '}
          <a className="text-link" href={`${manualHref(language)}#integrations`}>
            {t('ui.app.how_to_connect')}
          </a>
        </p>
        <p className="what-you-can-do-examples">
          <a className="text-link" href="#public-projects">
            {t('ui.app.see_public_examples')}
          </a>
        </p>
      </section>
      <PublicProjectDirectory />
      <footer className="login-footer">
        <LegalLinks />
      </footer>
    </div>
  );
}
export default function App() {
  useState(initializeLanguage);
  useLanguage();
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [pufuSource, setPufuSource] = useState<PufuSource>(pufuSourceFromHistory);
  const [questionListContext, setQuestionListContext] = useState({
    view: 'questions' as 'questions' | 'pufus',
    projectId: null as string | null,
    scope: null as string | null,
    hash: '#questions',
    scroll: 0,
  });
  const navigationGuard = useRef<(() => boolean) | null>(null);
  const previousHash = useRef(window.location.hash);
  const previousHistoryState = useRef(window.history?.state);
  const setNavigationGuard = useCallback((guard: (() => boolean) | null) => {
    navigationGuard.current = guard;
  }, []);
  const [libraryProjectId, setLibraryProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [savingStockFavorites, setSavingStockFavorites] = useState<string[]>([]);
  const stockMutationVersion = useRef(0);
  const [memoryResponse, setMemoryResponse] = useState<MemoryResponse>({
    memory: null,
    pending: false,
    error: null,
  });
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [modal, setModal] = useState<ModalState>(null);
  const [creatingPufu, setCreatingPufu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const sidebarOpen = isMobile ? mobileNav : !desktopNavCollapsed;
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [stockSource, setStockSource] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [questionCreation, setQuestionCreation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = projects.find((project) => project.id === route.projectId);
  const questionFlow =
    route.view === 'question' || route.view === 'resolve' || route.view === 'pufu';
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
  const listProjectId = route.projectId ?? (libraryView ? libraryProjectId : null);
  const filterProject = (projectId: string | null) => {
    setLibraryProjectId(projectId);
    setPage(1);
  };
  const reload = () => setRefresh((value) => value + 1);
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
    setModal(null);
    setMobileNav(false);
  };
  const openQuestion = (id: string) => {
    if (!questionFlow)
      setQuestionListContext({
        view: 'questions',
        projectId: route.projectId,
        scope: listProjectId,
        hash:
          route.view === 'questions'
            ? window.location.hash
            : `#questions${route.projectId ? `/${encodeURIComponent(route.projectId)}` : ''}`,
        scroll: route.view === 'questions' ? window.scrollY : 0,
      });
    navigateDetail('question', id);
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
    setMobileNav(false);
    setPage(1);
    setQuery('');
    setSearch('');
    setStockSource('all');
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
      previousHash.current = window.location.hash;
      previousHistoryState.current = window.history?.state;
      const nextRoute = routeFromHash();
      if (nextRoute.view === 'pufu') setPufuSource(pufuSourceFromHistory());
      setRoute(nextRoute);
      setPage(1);
    };
    window.addEventListener('hashchange', listener);
    window.addEventListener('popstate', listener);
    return () => {
      window.removeEventListener('hashchange', listener);
      window.removeEventListener('popstate', listener);
    };
  }, []);
  useEffect(() => {
    if (questionFlow) window.scrollTo(0, 0);
    else if (route.view === questionListContext.view)
      window.requestAnimationFrame(() => window.scrollTo(0, questionListContext.scroll));
  }, [
    route.view,
    route.detailId,
    questionFlow,
    questionListContext.scroll,
    questionListContext.view,
  ]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const listener = () => setIsMobile(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    if (!mobileNav || !isMobile) return;
    document.getElementById('sidebar-close')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      document.getElementById('sidebar-toggle')?.focus();
    };
  }, [mobileNav, isMobile]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<Config>('/api/config'),
      api<{
        user: User;
      }>('/api/v1/me').catch((e) => {
        if ((e as ApiError).status !== 401) throw e;
        return { user: null };
      }),
    ])
      .then(([settings, identity]) => {
        if (active) {
          setConfig(settings);
          applyAccountLanguage(identity.user);
          setUser(identity.user);
        }
      })
      .catch((e) => {
        if (active) setError(applicationError((e as Error).message));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user?.onboarding_completed_at) return;
    const controller = new AbortController();
    setLoading(true);
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      const version = stockMutationVersion.current;
      const params = new URLSearchParams({
        q: search,
        source: stockSource === 'favorites' ? 'all' : stockSource,
        page: String(page),
      });
      if (stockSource === 'favorites') params.set('favorite', 'true');
      if (listProjectId) params.set('project_id', listProjectId);
      try {
        const [projectData, stockData, memoryData, tokenData] = await Promise.all([
          api<{
            projects: Project[];
          }>('/api/v1/projects', { signal: controller.signal }),
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
          setProjects(projectData.projects);
          if (version === stockMutationVersion.current) {
            setStocks(stockData.stocks);
            setTotal(stockData.total);
            if (page > 1 && page > Math.max(1, Math.ceil(stockData.total / 24)))
              setPage(Math.max(1, Math.ceil(stockData.total / 24)));
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
    refresh,
  ]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const completed = (message: string) => {
    setModal(null);
    setNotice(message);
    reload();
  };
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
      setModal((current) =>
        current?.type === 'stock' && current.stock.id === result.id
          ? { ...current, stock: { ...current.stock, is_favorite: result.is_favorite } }
          : current,
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
      setModal((current) =>
        current?.type === 'stock' && current.stock.id === result.id
          ? { ...current, stock: { ...current.stock, title: result.title } }
          : current,
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
      setModal({ type: 'stock', stock });
    } catch (e) {
      setError(applicationError((e as Error).message));
    }
  };
  if (!config || user === undefined)
    return (
      <div className="boot">
        <Brand />
        {error ? <p role="status">{error}</p> : <BootMessage />}
      </div>
    );
  if (!user)
    return (
      <Login
        config={config}
        onLogin={async () => {
          await send('/api/auth/demo');
          const data = await api<{
            user: User;
          }>('/api/v1/me');
          applyAccountLanguage(data.user);
          setUser(data.user);
        }}
      />
    );
  if (!user.onboarding_completed_at)
    return (
      <Onboarding
        onComplete={(savedUser) => {
          applyAccountLanguage(savedUser);
          setUser(savedUser);
        }}
        onLogout={() => setUser(null)}
      />
    );
  const heading =
    route.view === 'settings'
      ? selected
        ? t('ui.app.settings_for_value', { value0: selected.name })
        : t('ui.app.project_settings')
      : route.view === 'questions'
        ? selected
          ? t('ui.app.questions_insights_in_value', { value0: selected.name })
          : t('ui.app.all_questions_insights')
        : route.view === 'pufus'
          ? selected
            ? t('ui.app.pufu_in_value', { value0: selected.name })
            : t('ui.app.all_pufu')
          : route.view === 'profile'
            ? t('ui.app.profile')
            : route.view === 'mcp'
              ? t('ui.app.integrations')
              : route.view === 'shortcuts'
                ? t('ui.app.shortcut_integration')
                : route.view === 'memory'
                  ? selected
                    ? t('ui.app.memory_for_value', { value0: selected.name })
                    : t('ui.app.your_memory')
                  : (selected?.name ?? t('ui.app.all_stocks'));
  const questionListProject = projects.find(
    (project) => project.id === questionListContext.projectId,
  );
  const listLabel =
    questionListContext.view === 'pufus' ? t('ui.app.pufu') : t('ui.app.questions_insights');
  const breadcrumbListLabel = route.view === 'pufu' ? t('ui.app.pufu') : listLabel;
  const breadcrumbListHash =
    route.view === 'pufu'
      ? `#pufus${questionListContext.projectId ? `/${encodeURIComponent(questionListContext.projectId)}` : ''}`
      : questionListContext.hash;
  const questionListHeading = questionListProject
    ? t('ui.app.value_in_value', { value0: questionListProject.name, value1: breadcrumbListLabel })
    : t('ui.app.all_value', { value0: breadcrumbListLabel });
  const headerProjectId = questionFlow ? questionListContext.projectId : route.projectId;
  const headerProject = questionFlow ? questionListProject : selected;
  const headerLabel = headerProjectId
    ? headerLabels()[route.view]
    : (globalHeaderLabels()[route.view] ?? headerLabels()[route.view]);
  const listedProjects = projects.filter((project) => project.show_in_all_lists !== false);
  const allCount = listedProjects.reduce((count, project) => count + project.count, 0);
  const allQuestionCount = listedProjects.reduce(
    (count, project) => count + project.question_count,
    0,
  );
  const allPufuCount = listedProjects.reduce((count, project) => count + project.pufu_count, 0);
  return (
    <div className={`app-shell ${!isMobile && desktopNavCollapsed ? 'sidebar-collapsed' : ''}`}>
      {isMobile && mobileNav && (
        <button
          className="nav-scrim"
          aria-label={t('ui.app.close_menu')}
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? 'nav-open' : ''}`} id="sidebar" inert={!sidebarOpen}>
        <Brand />
        <button
          id="sidebar-close"
          className="icon-button sidebar-close"
          aria-label={t('ui.app.close_menu')}
          onClick={() => {
            if (isMobile) setMobileNav(false);
            else {
              setDesktopNavCollapsed(true);
              window.requestAnimationFrame(() =>
                document.getElementById('sidebar-toggle')?.focus(),
              );
            }
          }}
        >
          <X size={19} aria-hidden="true" />
        </button>
        <nav aria-label={t('ui.app.main_navigation')}>
          <button
            className={`nav-item ${route.view === 'stocks' && !route.projectId ? 'active' : ''}`}
            aria-current={route.view === 'stocks' && !route.projectId ? 'page' : undefined}
            onClick={() => {
              filterProject(null);
              navigate('stocks');
            }}
          >
            <Layers size={19} aria-hidden="true" />
            {t('ui.app.all_stocks')}
            <span className="nav-count">{allCount}</span>
          </button>
          <button
            className={`nav-item ${allQuestionsActive ? 'active' : ''}`}
            aria-current={allQuestionsActive ? 'page' : undefined}
            onClick={() => {
              filterProject(null);
              navigate('questions');
            }}
          >
            <CircleHelp size={19} aria-hidden="true" />
            {t('ui.app.all_questions_insights')}
            <span className="nav-count">{allQuestionCount}</span>
          </button>
          <button
            className={`nav-item ${allPufusActive ? 'active' : ''}`}
            aria-current={allPufusActive ? 'page' : undefined}
            onClick={() => {
              filterProject(null);
              navigate('pufus');
            }}
          >
            <Network className="pufu-icon" size={19} aria-hidden="true" />
            {t('ui.app.all_pufu')}
            <span className="nav-count">{allPufuCount}</span>
          </button>
          <button
            className={`nav-item ${route.view === 'memory' && !route.projectId ? 'active' : ''}`}
            onClick={() => navigate('memory')}
          >
            <Sparkles size={19} aria-hidden="true" />
            {t('ui.app.your_memory')}
          </button>
          <div className="nav-section">
            <span>{t('ui.app.projects')}</span>
            <button
              className="icon-button small"
              aria-label={t('ui.app.create_project')}
              onClick={() => {
                setModal({ type: 'project' });
                setMobileNav(false);
              }}
            >
              <Plus size={17} />
            </button>
          </div>
          {projects.map((project, index) => (
            <button
              key={project.id}
              className={`nav-item project-nav ${route.projectId === project.id ? 'active' : ''}`}
              onClick={() => navigate('stocks', project.id)}
            >
              <span className={`project-dot tone-${index % 4}`} />
              <span className="truncate">{project.name}</span>
              <span className="nav-count">{project.count}</span>
            </button>
          ))}
          {!projects.length && (
            <p className="sidebar-empty">
              {t('ui.app.create_your')}
              <br />
              {t('ui.app.first_project')}
            </p>
          )}
          <button className="new-project" onClick={() => setModal({ type: 'project' })}>
            <Plus size={17} aria-hidden="true" />
            {t('ui.app.add_project')}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <a
            className="nav-item"
            href={manualHref()}
            target="_blank"
            rel="noreferrer"
            aria-label={t('ui.app.user_manual_opens_in_a_new_tab')}
          >
            <BookOpen size={18} aria-hidden="true" />
            {t('ui.app.user_manual')}
          </a>
          <button
            className={`nav-item ${route.view === 'profile' ? 'active' : ''}`}
            aria-current={route.view === 'profile' ? 'page' : undefined}
            onClick={() => navigate('profile')}
          >
            <UserRound size={18} aria-hidden="true" />
            {t('ui.app.profile')}
          </button>
          <button
            className={`nav-item ${route.view === 'shortcuts' ? 'active' : ''}`}
            onClick={() => navigate('shortcuts')}
          >
            <KeyRound size={18} aria-hidden="true" />
            {t('ui.app.shortcut_integration')}
          </button>
          <button
            className={`nav-item ${route.view === 'mcp' ? 'active' : ''}`}
            aria-current={route.view === 'mcp' ? 'page' : undefined}
            onClick={() => navigate('mcp')}
          >
            <Layers size={18} aria-hidden="true" />
            {t('ui.app.integrations')}
          </button>
          <div className="user-row">
            <div className="avatar">{user.name.slice(0, 1)}</div>
            <div className="user-info">
              <strong>{user.name}</strong>
              {config.demo && <span>{t('ui.app.local_demo')}</span>}
            </div>
            <button
              className="icon-button"
              aria-label={t('ui.app.sign_out')}
              onClick={async () => {
                try {
                  await send('/api/v1/logout');
                  setUser(null);
                } catch (e) {
                  setError(applicationError((e as Error).message));
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="workspace" inert={isMobile && mobileNav}>
        <ScrollHeader autoHide={isMobile}>
          {!sidebarOpen && (
            <button
              id="sidebar-toggle"
              className="icon-button sidebar-toggle"
              aria-label={t('ui.app.open_menu')}
              aria-controls="sidebar"
              aria-expanded={false}
              onClick={() => {
                if (isMobile) setMobileNav(true);
                else {
                  setDesktopNavCollapsed(false);
                  window.requestAnimationFrame(() =>
                    document.getElementById('sidebar-close')?.focus(),
                  );
                }
              }}
            >
              <Menu size={22} aria-hidden="true" />
            </button>
          )}
          <nav className="breadcrumb" aria-label={t('ui.app.breadcrumbs')}>
            <a href="#">
              {!sidebarOpen && (
                <img
                  className="brand-mark"
                  src="/pufu-lens-logo.png"
                  alt=""
                  width="28"
                  height="28"
                />
              )}
              {t('ui.app.home')}
            </a>{' '}
            <span aria-hidden="true">/</span>{' '}
            {headerProjectId && (
              <>
                <a
                  className="breadcrumb-project"
                  href={`#project/${encodeURIComponent(headerProjectId)}`}
                  title={headerProject?.name ?? t('ui.app.projects')}
                >
                  <span className="breadcrumb-project-name">
                    {headerProject?.name ?? t('ui.app.projects')}
                  </span>
                </a>{' '}
                <span aria-hidden="true">/</span>{' '}
              </>
            )}
            {questionFlow ? (
              <>
                <a href={breadcrumbListHash} title={questionListHeading}>
                  {headerProjectId
                    ? breadcrumbListLabel
                    : t('ui.app.all_value', { value0: breadcrumbListLabel })}
                </a>{' '}
                <span aria-hidden="true">/</span>{' '}
                <a
                  href={`#${route.view}/${encodeURIComponent(route.detailId!)}`}
                  aria-current="page"
                >
                  {headerLabel}
                </a>
              </>
            ) : (
              <a href={window.location.hash || '#'} aria-current="page">
                {headerLabel}
              </a>
            )}
          </nav>
        </ScrollHeader>
        {config.demo && (
          <div className="demo-banner">
            <BookOpen size={15} aria-hidden="true" />
            <span>
              {config.aiEnabled
                ? t('ui.app.local_demo_includes_sample_articles_new_ai_generation_uses')
                : t('ui.app.local_demo_includes_sample_articles_without_ai_new_summaries')}
            </span>
          </div>
        )}
        <div className="page-body">
          {!questionFlow && (
            <header className="page-header">
              <div>
                <h1>{heading}</h1>
                {route.view !== 'profile' && (
                  <p>
                    {route.view === 'questions'
                      ? t('ui.app.collect_questions_and_insights_from_everyday_life_and_saved')
                      : route.view === 'pufus'
                        ? t('ui.app.review_ideas_for_solutions_inspired_by_your_questions_and')
                        : route.view === 'settings'
                          ? t('ui.app.edit_this_project_s_settings')
                          : route.view === 'mcp'
                            ? t('ui.app.connect_conversations_with_stocks_questions_and_insights')
                            : route.view === 'shortcuts'
                              ? t('ui.app.save_articles_from_your_iphone_directly_to_a_project')
                              : route.view === 'memory'
                                ? t(
                                    'ui.app.interests_and_knowledge_from_your_articles_gradually_updated_with',
                                  )
                                : selected?.description ||
                                  t('ui.app.keep_interesting_articles_and_new_ideas_together')}
                  </p>
                )}
              </div>
              <div className="header-actions">
                {libraryView && (
                  <div className="header-project-select">
                    <label htmlFor="project-scope">{t('ui.app.projects')}</label>
                    <div className="project-select-control">
                      <select
                        id="project-scope"
                        value={libraryProjectId ?? ''}
                        onChange={(event) => filterProject(event.target.value || null)}
                      >
                        <option value="">{t('ui.app.all_projects')}</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} aria-hidden="true" />
                    </div>
                  </div>
                )}
                {route.view === 'stocks' && (
                  <button
                    className="button primary"
                    onClick={() =>
                      setModal(projects.length ? { type: 'save' } : { type: 'project' })
                    }
                  >
                    <Plus size={18} aria-hidden="true" />
                    {projects.length ? t('ui.app.save_article') : t('ui.app.create_project')}
                  </button>
                )}
                {route.view === 'questions' && (
                  <button className="button primary" onClick={() => setModal({ type: 'question' })}>
                    <Plus size={18} aria-hidden="true" />
                    {t('ui.app.add_question_or_insight')}
                  </button>
                )}
                {route.view === 'pufus' && (
                  <button
                    className="button primary"
                    onClick={() => setModal({ type: 'pufu' })}
                    disabled={!projects.length}
                  >
                    <Plus size={18} aria-hidden="true" />
                    {t('ui.app.add_pufu')}
                  </button>
                )}
              </div>
            </header>
          )}
          {(route.view === 'stocks' ||
            route.view === 'questions' ||
            route.view === 'pufus' ||
            route.view === 'settings' ||
            route.view === 'memory') && (
            <div
              className={`detail-tabs library-tabs${route.projectId ? ' project-tabs' : ''}`}
              aria-label={route.projectId ? t('ui.app.project_views') : t('ui.app.library_views')}
            >
              <button
                className={route.view === 'stocks' ? 'active' : ''}
                aria-pressed={route.view === 'stocks'}
                onClick={() => navigate('stocks', route.projectId)}
              >
                <Bookmark size={16} aria-hidden="true" />
                {t('ui.app.stocks')}
              </button>
              <button
                className={route.view === 'questions' ? 'active' : ''}
                aria-pressed={route.view === 'questions'}
                onClick={() => navigate('questions', route.projectId)}
              >
                <CircleHelp size={16} aria-hidden="true" />
                {t('ui.app.questions_insights')}
              </button>
              <button
                className={route.view === 'pufus' ? 'active' : ''}
                aria-pressed={route.view === 'pufus'}
                onClick={() => navigate('pufus', route.projectId)}
              >
                <Network className="pufu-icon" size={16} aria-hidden="true" />
                {t('ui.app.pufu')}
              </button>
              <button
                className={route.view === 'memory' ? 'active' : ''}
                aria-pressed={route.view === 'memory'}
                onClick={() => navigate('memory', route.projectId)}
              >
                <Sparkles size={16} aria-hidden="true" />
                {t('ui.app.memory')}
              </button>
              {route.projectId && (
                <button
                  className={route.view === 'settings' ? 'active' : ''}
                  aria-pressed={route.view === 'settings'}
                  onClick={() => navigate('settings', route.projectId)}
                >
                  <Settings size={16} aria-hidden="true" />
                  {t('ui.app.settings')}
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={18} aria-hidden="true" />
              {notice}
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button className="button text-button" onClick={reload}>
                {t('ui.app.reload')}
              </button>
            </div>
          )}
          {(route.view === 'questions' ||
            (questionFlow && questionListContext.view === 'questions')) && (
            <div hidden={route.view !== 'questions'}>
              <Questions
                key={`${(questionFlow ? questionListContext.projectId : route.projectId) ?? 'all'}-${questionCreation}`}
                active={route.view === 'questions'}
                projectId={questionFlow ? questionListContext.scope : listProjectId}
                refresh={refresh}
                onQuestion={openQuestion}
                onScope={(id) => {
                  if (libraryView) filterProject(id);
                  else navigate('questions', id);
                }}
                onOpen={async (id) => {
                  const { stock } = await api<{
                    stock: Stock;
                  }>(`/api/v1/stocks/${id}`);
                  setModal({ type: 'stock', stock, tab: 'question' });
                }}
              />
            </div>
          )}
          {(route.view === 'pufus' || (questionFlow && questionListContext.view === 'pufus')) && (
            <div hidden={route.view !== 'pufus'}>
              <Pufus
                key={(questionFlow ? questionListContext.projectId : route.projectId) ?? 'all'}
                projectId={questionFlow ? questionListContext.scope : listProjectId}
                active={route.view === 'pufus'}
                refresh={refresh}
                onPufu={openPufu}
              />
            </div>
          )}
          {questionFlow ? (
            route.view === 'pufu' ? (
              <PufuPage
                key={route.detailId}
                id={route.detailId!}
                onQuestion={(id) => navigateDetail('question', id)}
                backLabel={
                  pufuSource.questionId
                    ? t('ui.app.back_to_question_or_insight')
                    : t('ui.app.back_to_pufu_list')
                }
                onBack={() => {
                  if (pufuSource.questionId) navigateDetail('question', pufuSource.questionId);
                  else
                    window.location.hash = `#pufus${pufuSource.projectId ? `/${encodeURIComponent(pufuSource.projectId)}` : ''}`;
                }}
                onGuard={setNavigationGuard}
                onDeleted={() => {
                  setNotice(t('ui.pufu_page.pufu_deleted'));
                  reload();
                  if (pufuSource.questionId) navigateDetail('question', pufuSource.questionId);
                  else
                    window.location.hash = `#pufus${pufuSource.projectId ? `/${encodeURIComponent(pufuSource.projectId)}` : ''}`;
                }}
              />
            ) : (
              <QuestionPage
                key={route.detailId}
                id={route.detailId!}
                projects={projects}
                resolve={route.view === 'resolve'}
                onUpdated={reload}
                backLabel={t('ui.app.back_to_value_list', { value0: listLabel })}
                onBack={() => {
                  if (route.view === 'resolve') navigateDetail('question', route.detailId!);
                  else window.location.hash = questionListContext.hash;
                }}
                onResolve={() => navigateDetail('resolve', route.detailId!)}
                onPufu={(id) => navigateDetail('pufu', id)}
                onDeleted={() => {
                  setNotice(t('ui.app.question_or_insight_deleted'));
                  reload();
                  window.location.hash = questionListContext.hash;
                }}
                onStock={async (id) => {
                  const { stock } = await api<{
                    stock: Stock;
                  }>(`/api/v1/stocks/${encodeURIComponent(id)}`);
                  setModal({ type: 'stock', stock });
                }}
              />
            )
          ) : route.view === 'settings' ? (
            <section className="project-settings" aria-label={t('ui.app.project_settings')}>
              {selected ? (
                <ProjectForm
                  key={selected.id}
                  project={selected}
                  onDone={() => completed(t('ui.app.project_settings_saved'))}
                  onDelete={() => {
                    completed(t('ui.app.project_deleted'));
                    filterProject(null);
                    navigate('stocks');
                  }}
                />
              ) : (
                <p className="content-loading">
                  <Spinner />
                  {t('ui.app.loading_project')}
                </p>
              )}
            </section>
          ) : route.view === 'questions' || route.view === 'pufus' ? null : route.view ===
            'profile' ? (
            <Profile
              user={user}
              onSave={(savedUser) => {
                applyAccountLanguage(savedUser);
                setUser(savedUser);
                setNotice(t('ui.app.profile_saved'));
              }}
            />
          ) : route.view === 'mcp' ? (
            <McpConnections />
          ) : route.view === 'shortcuts' ? (
            <Shortcuts
              baseUrl={config?.appUrl ?? window.location.origin}
              projects={projects}
              tokens={tokens}
              onCreate={() => setModal({ type: 'token' })}
              onRevoke={async (id) => {
                try {
                  await api(`/api/v1/tokens/${id}`, { method: 'DELETE' });
                  setNotice(t('ui.app.token_revoked'));
                  reload();
                } catch (e) {
                  setError(applicationError((e as Error).message));
                }
              }}
            />
          ) : route.view === 'memory' ? (
            <div className="memory-page">
              <MemoryPanel
                response={memoryResponse}
                project={selected}
                full
                onEvidence={evidence}
                onRebuild={() => setModal({ type: 'memory', projectId: route.projectId })}
              />
            </div>
          ) : (
            <div className="content-layout">
              <section className="stock-section" aria-label={t('ui.app.saved_articles')}>
                <SearchField
                  label={t('ui.app.search_articles')}
                  placeholder={t('ui.app.search_titles_summaries_and_notes')}
                  value={query}
                  clearable={Boolean(query || search)}
                  onChange={setQuery}
                  onSearch={() => {
                    setSearch(query.trim());
                    setPage(1);
                    reload();
                  }}
                  onClear={() => {
                    setQuery('');
                    setSearch('');
                    setPage(1);
                    reload();
                  }}
                />
                <div className="filter-row">
                  <div className="filters" aria-label={t('ui.app.stock_filters')}>
                    {[
                      ['all', t('ui.app.all')],
                      ['web', 'web'],
                      ['user', t('ui.app.text')],
                      ['favorites', t('ui.app.favorites')],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={stockSource === value ? 'selected' : ''}
                        aria-pressed={stockSource === value}
                        onClick={() => {
                          setStockSource(value);
                          setPage(1);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="result-count">{t('count.items', { count: total })}</span>
                </div>
                {loading && !stocks.length ? (
                  <div className="empty-state">
                    <Spinner />
                    <p>{t('ui.app.loading_articles')}</p>
                  </div>
                ) : !stocks.length ? (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Bookmark size={28} aria-hidden="true" />
                    </span>
                    <h2>
                      {search || stockSource !== 'all'
                        ? t('ui.app.no_matching_articles')
                        : t('ui.app.start_growing_your_knowledge_here')}
                    </h2>
                    <p>
                      {search || stockSource !== 'all'
                        ? t('ui.app.try_a_different_search_or_filter')
                        : t('ui.app.save_a_url_or_text_summaries_and_memory_update')}
                    </p>
                    {!search && stockSource === 'all' && (
                      <button
                        className="button primary"
                        onClick={() =>
                          setModal(projects.length ? { type: 'save' } : { type: 'project' })
                        }
                      >
                        <Plus size={17} aria-hidden="true" />
                        {projects.length
                          ? t('ui.app.save_your_first_article')
                          : t('ui.app.create_project')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="article-grid">
                    {stocks.map((stock) => (
                      <ArticleCard
                        key={stock.id}
                        stock={stock}
                        onOpen={() => setModal({ type: 'stock', stock })}
                        favoriteBusy={savingStockFavorites.includes(stock.id)}
                        onFavorite={() => {
                          void toggleStockFavorite(stock).catch((e: Error) =>
                            setError(applicationError(e.message)),
                          );
                        }}
                      />
                    ))}
                  </div>
                )}
                {total > 24 && (
                  <div className="pagination">
                    <button
                      className="button secondary"
                      disabled={page === 1}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      <ChevronLeft size={17} aria-hidden="true" />
                      {t('ui.app.previous')}
                    </button>
                    <span>
                      {page} / {Math.ceil(total / 24)}
                    </span>
                    <button
                      className="button secondary"
                      disabled={page * 24 >= total}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      {t('ui.app.next')}
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                  </div>
                )}
                <footer className="library-footer">
                  <LegalLinks newTab />
                </footer>
              </section>
              <aside className="memory-aside">
                <MemoryPanel response={memoryResponse} project={selected} onEvidence={evidence} />
              </aside>
            </div>
          )}
        </div>
      </main>
      {modal?.type === 'memory' && (
        <Modal title={t('ui.app.how_to_update_memory')} onClose={() => setModal(null)}>
          <MemoryRebuildForm
            projectId={modal.projectId}
            projectName={projects.find((project) => project.id === modal.projectId)?.name}
            onClose={() => setModal(null)}
            onDone={() => completed(t('ui.app.memory_update_accepted'))}
          />
        </Modal>
      )}
      {modal?.type === 'project' && (
        <Modal
          title={modal.project ? t('ui.app.edit_project') : t('ui.app.new_project')}
          onClose={() => setModal(null)}
        >
          <ProjectForm
            project={modal.project}
            onDone={(id) => {
              completed(modal.project ? t('ui.app.project_updated') : t('ui.app.project_created'));
              navigate('stocks', id);
            }}
            onDelete={() => {
              completed(t('ui.app.project_deleted'));
              navigate('stocks');
            }}
          />
        </Modal>
      )}
      {modal?.type === 'save' && (
        <Modal title={t('ui.app.save_article')} onClose={() => setModal(null)}>
          <SaveForm
            projects={projects}
            projectId={listProjectId}
            onDone={(duplicate, youtube) =>
              completed(
                youtube
                  ? t('ui.app.youtube_url_saved')
                  : duplicate
                    ? t('ui.app.this_article_is_already_saved')
                    : t('ui.app.article_saved_its_summary_will_be_generated_automatically'),
              )
            }
          />
        </Modal>
      )}
      {modal?.type === 'question' && (
        <Modal title={t('ui.app.add_question_or_insight')} onClose={() => setModal(null)}>
          <QuestionForm
            projects={projects}
            projectId={listProjectId}
            onDone={(projectId) => {
              completed(t('ui.app.question_or_insight_added'));
              setQuestionCreation((value) => value + 1);
              if (route.projectId) navigate('questions', projectId);
              else if (libraryProjectId) filterProject(projectId);
            }}
          />
        </Modal>
      )}
      {modal?.type === 'pufu' && (
        <PufuModal
          title={t('ui.app.add_pufu')}
          wide={false}
          busy={creatingPufu}
          onClose={() => setModal(null)}
        >
          <PufuForm
            projects={projects}
            projectId={listProjectId}
            onBusyChange={setCreatingPufu}
            onDone={openPufu}
          />
        </PufuModal>
      )}
      {modal?.type === 'stock' && (
        <Modal title={t('ui.app.source_articles')} wide onClose={() => setModal(null)}>
          <StockDetail
            key={modal.stock.id}
            stock={stocks.find((stock) => stock.id === modal.stock.id) ?? modal.stock}
            projects={projects}
            initialTab={modal.tab ?? 'summary'}
            onDone={completed}
            onQuestion={openQuestion}
            favoriteBusy={savingStockFavorites.includes(modal.stock.id)}
            onFavorite={toggleStockFavorite}
            onRename={renameStock}
          />
        </Modal>
      )}
      {modal?.type === 'token' && (
        <Modal
          title={t('ui.app.create_shortcut_token')}
          onClose={() => {
            setModal(null);
            reload();
          }}
        >
          <TokenForm projects={projects} />
        </Modal>
      )}
    </div>
  );
}
function ArticleCard({
  stock,
  onOpen,
  onFavorite,
  favoriteBusy,
}: {
  stock: Stock;
  onOpen: () => void;
  onFavorite: () => void;
  favoriteBusy: boolean;
}) {
  useLanguage();
  const youtube = stock.source_type === 'url' && isYouTubeUrl(stock.source_url);
  return (
    <article className="article-card">
      <div className="article-meta">
        <span className="site-mark">
          {stock.source_type === 'text' ? (
            <BookOpen size={13} aria-hidden="true" />
          ) : (
            <Globe size={13} aria-hidden="true" />
          )}
        </span>
        <span className="domain truncate">
          {stock.source_type === 'text' ? t('ui.app.text') : stock.domain.replace('www.', '')}
        </span>
        {stock.status !== 'ready' && !youtube && (
          <span className={`status status-${stock.status}`}>
            {stock.status !== 'failed' && <span className="status-dot" />}
            {statusLabels()[stock.status]}
          </span>
        )}
        <span className="article-project">
          <Folder size={13} aria-hidden="true" />
          <span className="truncate">{stock.project_name}</span>
        </span>
      </div>
      <div className="article-content">
        <h2 className="article-title">
          <button type="button" className="article-open" onClick={onOpen}>
            {youtube ? youtubeDisplayTitle(stock.title) : stock.title}
          </button>
        </h2>
        <p className="article-summary">
          {youtube
            ? t('ui.app.youtube_link_saved_open_the_details_to_view_the')
            : (stock.summary?.overview ??
              (applicationError(stock.error) || undefined) ??
              (stock.source_type === 'text'
                ? t('ui.app.summarizing_the_key_points_from_your_saved_text')
                : t('ui.app.retrieving_the_article_and_summarizing_its_key_points_you')))}
        </p>
      </div>
      {youtube && (
        <button
          type="button"
          className="youtube-thumbnail"
          aria-label={t('ui.app.open_details_for_value', {
            value0: youtubeDisplayTitle(stock.title),
          })}
          onClick={onOpen}
        >
          <YouTubeThumbnail url={stock.source_url} />
        </button>
      )}
      <div className="article-tags">
        {stock.summary?.topics.slice(0, 3).map((topic) => (
          <span key={topic}>{topic}</span>
        ))}
      </div>
      <footer>
        <time dateTime={stock.created_at}>
          {new Intl.DateTimeFormat(intlLocale(), {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone: 'Asia/Tokyo',
          }).format(new Date(stock.created_at))}
        </time>
        <StockFavoriteButton stock={stock} busy={favoriteBusy} onClick={onFavorite} />
      </footer>
    </article>
  );
}
function StockFavoriteButton({
  stock,
  busy,
  onClick,
  showLabel = false,
}: {
  stock: Stock;
  busy: boolean;
  onClick: () => void;
  showLabel?: boolean;
}) {
  useLanguage();
  return (
    <button
      type="button"
      className="stock-favorite"
      aria-label={
        stock.is_favorite ? t('ui.app.remove_from_favorites') : t('ui.app.add_to_favorites')
      }
      aria-pressed={Boolean(stock.is_favorite)}
      aria-busy={busy}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? (
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
      ) : (
        <Star size={20} strokeWidth={1.5} aria-hidden="true" />
      )}
      {showLabel && <span>{t('ui.app.favorites')}</span>}
    </button>
  );
}
function MemoryPanel({
  response,
  project,
  full = false,
  onRebuild,
  onEvidence,
}: {
  response: MemoryResponse;
  project?: Project;
  full?: boolean;
  onRebuild?: () => void;
  onEvidence: (id: string) => Promise<void>;
}) {
  useLanguage();
  const memory = response.memory;
  const data = memory?.data;
  return (
    <section className={`memory-card ${full ? 'full-memory' : ''}`}>
      <div className="memory-head">
        <span className="memory-symbol">
          <Sparkles size={20} aria-hidden="true" />
        </span>
        <div>
          <div className="eyebrow">GROWING MEMORY</div>
          <h2>{project ? t('ui.app.project_memory') : t('ui.app.your_memory')}</h2>
        </div>
        {response.pending && (
          <span className="memory-pending" aria-label={t('ui.app.updating_memory')}>
            <Spinner />
          </span>
        )}
      </div>
      <p className="memory-caption">
        {project
          ? t('ui.app.from_the_articles_collected_in_this_project')
          : t('ui.app.interests_across_eligible_projects')}
      </p>
      {response.coverage?.full_rebuild_reason && (
        <p className="update-note">{applicationError(response.coverage.full_rebuild_reason)}</p>
      )}
      {response.pending && <p className="update-note">{t('ui.app.incorporating_new_articles')}</p>}
      {response.error && (
        <p className="form-error" role="alert">
          {applicationError(response.error)}
        </p>
      )}
      {!data?.interests.length && !data?.knowledge.length ? (
        <div className="memory-empty">
          <div className="memory-seed">
            <span />
            <span />
            <span />
          </div>
          <p>
            {t('ui.app.as_your_article_collection_grows')}
            <br />
            {t('ui.app.your_interests_and_knowledge_connect_here')}
          </p>
        </div>
      ) : (
        <>
          <div className="memory-block">
            <h3>
              <span />
              {t('ui.app.interest_patterns')}
            </h3>
            <ul>
              {data.interests.slice(0, full ? 8 : 3).map((interest, index) => (
                <li key={index}>{interest}</li>
              ))}
            </ul>
          </div>
          <div className="memory-block knowledge">
            <h3>
              <BookOpen size={14} aria-hidden="true" />
              {t('ui.app.knowledge_from_articles')}
            </h3>
            <ul>
              {data.knowledge.slice(0, full ? 12 : 2).map((item, index) => (
                <li key={index}>
                  <MemoryKnowledge text={item.text}>
                    {item.articleIds.slice(0, full ? 5 : 1).map((id, sourceIndex) => (
                      <button key={id} onClick={() => void onEvidence(id)}>
                        {t('ui.app.source_articles')}
                        {item.articleIds.length > 1 ? ` ${sourceIndex + 1}` : ''}
                        <ArrowUpRight size={11} aria-hidden="true" />
                      </button>
                    ))}
                  </MemoryKnowledge>
                </li>
              ))}
            </ul>
          </div>
          {full && data.questions.length > 0 && (
            <div className="memory-block">
              <h3>{t('ui.app.open_questions')}</h3>
              <ul>
                {data.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="memory-foot">
        <span>
          {memory
            ? t('ui.app.generated_from_value_articles_updated_value', {
                value0: memory.article_count,
                value1: date(memory.updated_at),
              })
            : t('ui.app.updates_after_article_summaries')}
        </span>
      </div>
      {full && (
        <>
          <p className="memory-disclaimer">
            {t('ui.app.saving_an_article_does_not_imply_agreement_with_its')}
          </p>
          <div className="memory-controls">
            <button className="button secondary" disabled={response.pending} onClick={onRebuild}>
              <RefreshCw size={16} aria-hidden="true" />
              {t('ui.app.regenerate')}
            </button>
            {memory && (
              <button
                className="button secondary"
                onClick={() => {
                  const blob = new Blob([memory.text], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = t('ui.app.value_memory_txt', {
                    value0: project?.name ?? t('ui.app.user'),
                  });
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <ArrowDownToLine size={16} aria-hidden="true" />
                {t('ui.app.save_text')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
function ProjectForm({
  project,
  onDone,
  onDelete,
}: {
  project?: Project;
  onDone: (id: string) => void;
  onDelete: () => void;
}) {
  useLanguage();
  const [name, setName] = useState(project?.name ?? '');
  const nameId = useId();
  const [description, setDescription] = useState(project?.description ?? '');
  const descriptionId = useId();
  const [showInAllLists, setShowInAllLists] = useState(project?.show_in_all_lists ?? true);
  const listVisibilityId = useId();
  const [includeInUserMemory, setIncludeInUserMemory] = useState(
    project?.include_in_user_memory ?? true,
  );
  const userMemoryId = useId();
  const [autoGenerateQuestions, setAutoGenerateQuestions] = useState(
    project?.auto_generate_questions ?? true,
  );
  const autoQuestionsId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [idCopied, setIdCopied] = useState(false);
  const [idCopyError, setIdCopyError] = useState('');
  return (
    <>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const data = await send<{
              id: string;
            }>(
              project ? `/api/v1/projects/${project.id}` : '/api/v1/projects',
              {
                name,
                description,
                show_in_all_lists: showInAllLists,
                include_in_user_memory: includeInUserMemory,
                auto_generate_questions: autoGenerateQuestions,
              },
              project ? 'PATCH' : 'POST',
            );
            onDone(project?.id ?? data.id);
          } catch (e) {
            setError(applicationError((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="form-intro">
          {project
            ? t('ui.app.change_the_project_s_name_and_description_these_are')
            : t('ui.app.name_the_theme_you_want_to_collect_the_purpose')}
        </p>
        {project && (
          <>
            <dl className="project-id">
              <dt>{t('ui.app.project_id')}</dt>
              <dd className="project-id-row">
                <span className="project-id-value">{project.id}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('ui.app.copy_project_id')}
                  title={t('ui.app.copy_project_id')}
                  onClick={async () => {
                    setIdCopied(false);
                    setIdCopyError('');
                    try {
                      await navigator.clipboard.writeText(project.id);
                      setIdCopied(true);
                    } catch {
                      setIdCopyError(t('ui.app.could_not_copy_select_and_copy_the_project_id'));
                    }
                  }}
                >
                  <Copy size={16} aria-hidden="true" />
                </button>
              </dd>
            </dl>
            <p className="guide-note" role="status">
              {idCopied && t('ui.app.project_id_copied')}
            </p>
            <FormError error={idCopyError} />
          </>
        )}
        <label htmlFor={nameId}>{t('ui.app.project_name')}</label>
        <input
          id={nameId}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          autoFocus
          placeholder={t('ui.app.example_building_the_next_app')}
        />
        <label htmlFor={descriptionId}>
          {t('ui.app.project_description')}
          <span className="optional">{t('ui.app.optional')}</span>
        </label>
        <textarea
          id={descriptionId}
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={8}
          placeholder={t('ui.app.try_writing_about_what_you_want_to_achieve_and')}
        />
        <details className="project-advanced">
          <summary>{t('ui.app.advanced_settings')}</summary>
          <label className="project-memory-toggle" htmlFor={listVisibilityId}>
            <span>{t('ui.app.include_in_all_stocks_questions_insights_and_pufu_lists')}</span>
            <input
              id={listVisibilityId}
              type="checkbox"
              role="switch"
              checked={showInAllLists}
              disabled={busy}
              onChange={(event) => setShowInAllLists(event.target.checked)}
              aria-describedby={`${listVisibilityId}-hint`}
            />
          </label>
          <p id={`${listVisibilityId}-hint`} className="project-memory-hint">
            {t('ui.app.when_off_this_project_s_stocks_questions_insights_and')}
          </p>
          <label className="project-memory-toggle" htmlFor={userMemoryId}>
            <span>{t('ui.app.update_your_memory_when_adding_stocks')}</span>
            <input
              id={userMemoryId}
              type="checkbox"
              role="switch"
              checked={includeInUserMemory}
              disabled={busy}
              onChange={(event) => setIncludeInUserMemory(event.target.checked)}
              aria-describedby={`${userMemoryId}-hint`}
            />
          </label>
          <p id={`${userMemoryId}-hint`} className="project-memory-hint">
            {t('ui.app.project_memory_still_updates_when_off_articles_in_this')}
            {project && t('ui.app.saving_also_applies_changes_to_existing_memory')}
          </p>
          <label className="project-memory-toggle" htmlFor={autoQuestionsId}>
            <span>{t('ui.app.automatically_generate_questions_and_insights_from_stocks')}</span>
            <input
              id={autoQuestionsId}
              type="checkbox"
              role="switch"
              checked={autoGenerateQuestions}
              disabled={busy}
              onChange={(event) => setAutoGenerateQuestions(event.target.checked)}
              aria-describedby={`${autoQuestionsId}-hint`}
            />
          </label>
          <p id={`${autoQuestionsId}-hint`} className="project-memory-hint">
            {t('ui.app.when_off_no_questions_or_insights_are_automatically_generated')}
          </p>
        </details>
        <FormError error={error} />
        <div className="form-actions">
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Check size={17} aria-hidden="true" />}
            {project ? t('ui.app.save') : t('ui.app.create_project')}
          </button>
        </div>
      </form>
      {project && (
        <>
          <ProjectPublicationSettings key={project.id} projectId={project.id} />
          <DeleteAction
            summary={t('ui.app.project_deletion')}
            label={t('ui.app.delete_project')}
            title={t('ui.app.delete_this_project')}
            disabled={busy}
            onDelete={async () => {
              await api(`/api/v1/projects/${project.id}`, { method: 'DELETE' });
              onDelete();
            }}
          >
            <p className="delete-target">{project.name}</p>
            <p>{t('ui.app.delete_this_project_s_stocks_questions_insights_pufu_all')}</p>
            <p>{t('ui.app.if_published_its_public_page_will_also_become_unavailable')}</p>
          </DeleteAction>
        </>
      )}
    </>
  );
}
function SaveForm({
  projects,
  projectId,
  onDone,
}: {
  projects: Project[];
  projectId: string | null;
  onDone: (duplicate: boolean, youtube: boolean) => void;
}) {
  useLanguage();
  const [type, setType] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [target, setTarget] = useState(projectId ?? projects[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef(createRequestId());
  return (
    <form
      onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        const payload =
          type === 'url'
            ? {
                type,
                project_id: target,
                url,
                note,
              }
            : { type: 'text', project_id: target, title, text, note };
        const parsed = stockInputSchema.safeParse(payload);
        if (!parsed.success) {
          setError(
            type !== 'url' && !text.trim()
              ? t('ui.app.enter_the_article_text')
              : t('ui.app.check_your_input_the_length_or_format_is_incorrect'),
          );
          document.getElementById(type !== 'url' ? 'stock-text' : 'stock-url')?.focus();
          return;
        }
        setBusy(true);
        try {
          const result = await api<{
            duplicate: boolean;
          }>('/api/v1/stocks', {
            method: 'POST',
            headers: { 'Idempotency-Key': key.current },
            body: JSON.stringify(parsed.data),
          });
          onDone(result.duplicate, parsed.data.type === 'url' && isYouTubeUrl(parsed.data.url));
        } catch (e) {
          setError(applicationError((e as Error).message));
          if ((e as ApiError).status === 409) key.current = createRequestId();
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="form-intro">
        {t('ui.app.saving_a_url_or_text_generates_a_summary_and')}
        {projects.find((project) => project.id === target)?.auto_generate_questions !== false &&
          t('ui.app.questions_and_insights_are_also_generated_automatically')}
      </p>
      <div
        className="stock-source-tabs"
        role="tablist"
        aria-label={t('ui.app.type')}
        onKeyDown={(event) => {
          if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const nextType =
            event.key === 'Home'
              ? 'url'
              : event.key === 'End'
                ? 'text'
                : type === 'url'
                  ? 'text'
                  : 'url';
          setType(nextType);
          setError('');
          key.current = createRequestId();
          document.getElementById(`stock-source-tab-${nextType}`)?.focus();
        }}
      >
        {(
          [
            ['url', 'URL'],
            ['text', t('ui.app.text')],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            id={`stock-source-tab-${value}`}
            type="button"
            role="tab"
            aria-selected={type === value}
            aria-controls="stock-source-panel"
            tabIndex={type === value ? 0 : -1}
            autoFocus={value === 'url'}
            disabled={busy}
            onClick={() => {
              setType(value);
              setError('');
              key.current = createRequestId();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div id="stock-source-panel" role="tabpanel" aria-labelledby={`stock-source-tab-${type}`}>
        <label htmlFor="stock-project">{t('ui.app.destination_project')}</label>
        <select
          id="stock-project"
          value={target}
          disabled={busy || !projects.length}
          onChange={(e) => {
            setTarget(e.target.value);
            key.current = createRequestId();
          }}
        >
          {!target && <option value="">{t('ui.app.select_a_project')}</option>}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {type === 'url' ? (
          <>
            <label htmlFor="stock-url">{t('ui.app.post_url')}</label>
            <input
              id="stock-url"
              type="url"
              value={url}
              disabled={busy}
              onChange={(e) => {
                setUrl(e.target.value);
                key.current = createRequestId();
              }}
              required
              maxLength={4096}
              placeholder="https://…"
            />
            <p className="profile-hint">
              {t('ui.app.to_retrieve_x_posts_register_a_bearer_token_in')}
            </p>
          </>
        ) : (
          <>
            <label htmlFor="stock-text">{t('ui.app.content')}</label>
            <textarea
              id="stock-text"
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
                key.current = createRequestId();
              }}
              required
              maxLength={stockTextLimit}
              rows={6}
              aria-describedby="stock-text-hint"
              placeholder={t('ui.app.enter_or_paste_the_text_you_want_to_save')}
            />
            <p id="stock-text-hint" className="profile-hint profile-bio-hint">
              <span>{t('ui.app.up_to_20_000_characters')}</span>
              <span>{text.length.toLocaleString(intlLocale())} / 20,000</span>
            </p>
          </>
        )}
        <details className="stock-details">
          <summary>
            {t('ui.app.details')}
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {type === 'text' && (
            <>
              <label htmlFor="stock-text-title">
                {t('ui.app.title')}
                <span className="optional">{t('ui.app.optional')}</span>
              </label>
              <input
                id="stock-text-title"
                value={title}
                disabled={busy}
                onChange={(e) => {
                  setTitle(e.target.value);
                  key.current = createRequestId();
                }}
                maxLength={200}
                placeholder={t('ui.app.if_empty_the_first_line_of_the_text_is')}
              />
            </>
          )}
          <label htmlFor="stock-note">
            {t('ui.app.note')}
            <span className="optional">{t('ui.app.optional')}</span>
          </label>
          <textarea
            id="stock-note"
            value={note}
            disabled={busy}
            onChange={(e) => {
              setNote(e.target.value);
              key.current = createRequestId();
            }}
            maxLength={2000}
            rows={3}
            placeholder={t('ui.app.why_it_caught_your_attention_or_what_you_want')}
          />
        </details>
      </div>
      <FormError error={error} />
      <div className="form-actions">
        <button className="button primary" disabled={busy || !target}>
          {busy ? <Spinner /> : <Bookmark size={17} aria-hidden="true" />}
          {busy ? t('ui.app.saving') : t('ui.app.save_stock')}
        </button>
      </div>
    </form>
  );
}
function StockDetail({
  stock,
  projects,
  initialTab,
  onDone,
  onQuestion,
  onFavorite,
  favoriteBusy,
  onRename,
}: {
  stock: Stock;
  projects: Project[];
  initialTab: 'summary' | 'question';
  onDone: (message: string) => void;
  onQuestion: (id: string) => void;
  onFavorite: (stock: Stock) => Promise<void>;
  favoriteBusy: boolean;
  onRename: (stock: Stock, title: string) => Promise<void>;
}) {
  useLanguage();
  const youtube = stock.source_type === 'url' && isYouTubeUrl(stock.source_url);
  const displayTitle = youtube ? youtubeDisplayTitle(stock.title) : stock.title;
  const [tab, setTab] = useState<string>(youtube ? 'summary' : initialTab);
  const [note, setNote] = useState(stock.note);
  const [projectId, setProjectId] = useState(stock.project_id);
  const [content, setContent] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [supplemental, setSupplemental] = useState('');
  const [error, setError] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(displayTitle);
  const [titleError, setTitleError] = useState('');
  const titleInput = useRef<HTMLInputElement>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const noteHintId = useId();
  const titleId = useId();
  useEffect(() => {
    if (tab === 'note') noteInput.current?.focus();
  }, [tab]);
  useEffect(() => {
    if (editingTitle) {
      titleInput.current?.focus();
      titleInput.current?.select();
    }
  }, [editingTitle]);
  const finishEditingTitle = () => {
    setEditingTitle(false);
    window.requestAnimationFrame(() => titleButton.current?.focus());
  };
  useEffect(() => {
    let active = true;
    if (tab === 'content' && content === undefined)
      void api<{
        content: string | null;
      }>(`/api/v1/stocks/${stock.id}/content`)
        .then((result) => {
          if (active) setContent(result.content);
        })
        .catch((e) => {
          if (active) setError(applicationError((e as Error).message));
        });
    return () => {
      active = false;
    };
  }, [tab, content, stock.id]);
  return (
    <div className="stock-detail">
      <div className="detail-domain">
        {stock.source_type === 'text' ? t('ui.app.text') : stock.domain}{' '}
        {stock.status !== 'ready' && !youtube && (
          <span className={`status status-${stock.status}`}>{statusLabels()[stock.status]}</span>
        )}
      </div>
      {editingTitle ? (
        <form
          className="stock-title-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setTitleError('');
            try {
              await onRename(stock, title.trim());
              finishEditingTitle();
            } catch (e) {
              setTitleError(applicationError((e as Error).message));
            } finally {
              setBusy(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (!busy) finishEditingTitle();
            }
          }}
        >
          <label htmlFor={titleId}>{t('ui.app.title_2')}</label>
          <input
            ref={titleInput}
            id={titleId}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
            disabled={busy}
            aria-invalid={!!titleError}
          />
          <FormError error={titleError} />
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={finishEditingTitle}
            >
              {t('ui.app.cancel')}
            </button>
            <button className="button primary" disabled={busy || !title.trim()}>
              {busy ? <Spinner /> : <Check size={16} aria-hidden="true" />}
              {busy ? t('ui.app.saving') : t('ui.app.save')}
            </button>
          </div>
        </form>
      ) : (
        <div className="stock-detail-title">
          <h3>{displayTitle}</h3>
          <button
            ref={titleButton}
            type="button"
            className="icon-button"
            aria-label={t('ui.app.edit_title')}
            title={t('ui.app.edit_title')}
            disabled={busy}
            onClick={() => {
              setTitle(displayTitle);
              setTitleError('');
              setEditingTitle(true);
            }}
          >
            <Pencil size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="stock-detail-links">
        {stock.source_type === 'url' && (
          <a
            className="original-link"
            href={stock.source_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {youtube ? t('ui.app.open_on_youtube') : t('ui.app.open_original_article')}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
        <StockFavoriteButton
          stock={stock}
          busy={favoriteBusy}
          showLabel
          onClick={async () => {
            setError('');
            try {
              await onFavorite(stock);
            } catch (e) {
              setError(applicationError((e as Error).message));
            }
          }}
        />
      </div>
      <div className="detail-tabs" aria-label={t('ui.app.article_views')}>
        {(youtube
          ? [
              ['summary', t('ui.app.video')],
              ['comments', t('ui.app.comments')],
              ['note', t('ui.app.note_destination')],
            ]
          : [
              ['summary', t('ui.app.summary')],
              ['question', t('ui.app.questions_insights')],
              ['comments', t('ui.app.comments')],
              [
                'content',
                stock.source_type === 'text'
                  ? t('ui.app.entered_text')
                  : t('ui.app.retrieved_text'),
              ],
              ['note', t('ui.app.note_destination')],
            ]
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            className={tab === value ? 'active' : ''}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'summary' ? (
        <div className="detail-summary">
          {youtube ? (
            <YouTubePlayer url={stock.source_url} />
          ) : stock.summary ? (
            <>
              <p>{stock.summary.overview}</p>
              {stock.summary.shortSource && (
                <div className="local-model-note">
                  <p>{t('ui.app.this_text_is_short_so_the_original_is_shown')}</p>
                  {!stock.note.trim() && (
                    <>
                      <p>{t('ui.app.leave_a_short_note_about_why_it_caught_your')}</p>
                      <button className="button secondary" onClick={() => setTab('note')}>
                        {t('ui.app.leave_a_short_note')}
                      </button>
                    </>
                  )}
                </div>
              )}
              <h4>{t('ui.app.key_points')}</h4>
              <ul>
                {stock.summary.keyPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
              <div className="article-tags">
                {stock.summary.topics.map((topic) => (
                  <span key={topic}>{topic}</span>
                ))}
              </div>
              {stock.model?.startsWith('local') || stock.model === 'demo-fixture' ? (
                <p className="local-model-note">
                  {t('ui.app.this_is_a_demo_summary_newly_saved_articles_show')}
                </p>
              ) : null}
            </>
          ) : (
            <p>
              {(applicationError(stock.error) || undefined) ??
                t('ui.app.generating_the_summary_please_wait')}
            </p>
          )}
          {stock.status === 'failed' && !youtube && (
            <>
              {stock.source_type === 'url' && (
                <>
                  <label htmlFor="retry-content">
                    {t('ui.app.supply_article_text_and_retry_optional')}
                  </label>
                  <textarea
                    id="retry-content"
                    value={supplemental}
                    disabled={busy}
                    maxLength={stockTextLimit}
                    rows={5}
                    onChange={(event) => setSupplemental(event.target.value)}
                  />
                </>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await send(
                      `/api/v1/stocks/${stock.id}/retry`,
                      supplemental.trim() ? { supplemental_text: supplemental } : {},
                    );
                    onDone(
                      stock.source_type === 'text'
                        ? t('ui.app.summary_retry_accepted')
                        : t('ui.app.article_retrieval_retry_accepted'),
                    );
                  } catch (e) {
                    setError(applicationError((e as Error).message));
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {supplemental.trim()
                  ? t('ui.app.retry_with_this_text')
                  : stock.source_type === 'text'
                    ? t('ui.app.retry_summary')
                    : t('ui.app.retry_retrieval')}
              </button>
            </>
          )}
        </div>
      ) : tab === 'question' ? (
        <StockQuestion stockId={stock.id} onQuestion={onQuestion} />
      ) : tab === 'content' ? (
        content === undefined ? (
          <p className="content-loading">
            <Spinner />
            {t('ui.app.loading_article_text')}
          </p>
        ) : (
          <pre className="article-body">
            {content ?? t('ui.app.no_retrieved_text_is_available_for_sample_articles_open')}
          </pre>
        )
      ) : tab === 'note' ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await send(`/api/v1/stocks/${stock.id}`, { note, project_id: projectId }, 'PATCH');
              onDone(
                stock.summary?.shortSource && note !== stock.note
                  ? t('ui.app.note_saved_it_will_inform_questions_insights_and_memory')
                  : t('ui.app.note_and_destination_updated'),
              );
            } catch (e) {
              setError(applicationError((e as Error).message));
              setBusy(false);
            }
          }}
        >
          <label htmlFor="edit-note">
            {stock.summary?.shortSource
              ? t('ui.app.why_did_it_catch_your_attention_note')
              : t('ui.app.note_2')}
          </label>
          {stock.summary?.shortSource && (
            <p id={noteHintId} className="local-model-note">
              {t('ui.app.leave_a_short_note_to_inform_questions_insights_and')}
            </p>
          )}
          <textarea
            ref={noteInput}
            id="edit-note"
            aria-describedby={stock.summary?.shortSource ? noteHintId : undefined}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={2000}
            disabled={busy}
          />
          <label htmlFor="edit-project">{t('ui.app.destination_project')}</label>
          <select
            id="edit-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              {busy && <Spinner />}
              {t('ui.app.save_changes')}
            </button>
          </div>
        </form>
      ) : null}
      <div hidden={tab !== 'comments'}>
        <Comments targetType="stock" targetId={stock.id} />
      </div>
      <FormError error={error} />
      <div className="detail-footer">
        <span>
          {fullDate(stock.created_at)}
          {t('ui.app.saved_in')}
        </span>
      </div>
      <DeleteAction
        label={t('ui.app.delete_this_stock')}
        title={t('ui.app.delete_this_stock_2')}
        disabled={busy || favoriteBusy}
        onDelete={async () => {
          await api(`/api/v1/stocks/${stock.id}`, { method: 'DELETE' });
          onDone(t('ui.app.article_deleted_and_memory_update_accepted'));
        }}
      >
        <p className="delete-target">{displayTitle}</p>
        <p>
          {t('ui.app.destination')}
          {stock.project_name}
        </p>
        <p>{t('ui.app.delete_this_project_s_stock_and_its_comments_related')}</p>
        <p>{t('ui.app.this_cannot_be_undone')}</p>
      </DeleteAction>
    </div>
  );
}
function Shortcuts({
  baseUrl,
  projects,
  tokens,
  onCreate,
  onRevoke,
}: {
  baseUrl: string;
  projects: Project[];
  tokens: TokenInfo[];
  onCreate: () => void;
  onRevoke: (id: string) => Promise<void>;
}) {
  useLanguage();
  const base = baseUrl;
  const [projectId, setProjectId] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const example = JSON.stringify(
    {
      url: t('ui.app.article_url_from_step_03_magic_variable'),
      ...(projectId ? { project_id: projectId } : {}),
      note: '',
    },
    null,
    2,
  );
  return (
    <div className="shortcuts-page">
      <section className="connect-guide">
        <div className="guide-header">
          <span className="connect-symbol">
            <ArrowDownToLine size={23} aria-hidden="true" />
          </span>
          <div>
            <h2>{t('ui.app.save_articles_from_the_share_menu')}</h2>
            <p>{t('ui.app.save_an_article_from_the_share_menu_while_reading')}</p>
          </div>
        </div>
        <ol className="setup-steps">
          <li>
            <span>01</span>
            <div>
              <h3>{t('ui.app.create_a_token')}</h3>
              <p>{t('ui.app.use_create_token_below_you_can_restrict_the_destination')}</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>{t('ui.app.receive_urls_from_the_share_sheet')}</h3>
              <p>{t('ui.app.in_the_iphone_shortcuts_app_create_a_shortcut_with')}</p>
              <p>{t('ui.app.the_first_action_says_receive_from_share_sheet_give')}</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>{t('ui.app.add_get_urls_from_input')}</h3>
              <p>{t('ui.app.add_an_action_search_for_get_urls_and_set')}</p>
              <p>{t('ui.app.share_one_article_at_a_time_if_there_are')}</p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>{t('ui.app.post_with_get_contents_of_url')}</h3>
              <p>{t('ui.app.add_get_contents_of_url_and_paste_the_save')}</p>
              <p>{t('ui.app.choose_text_for_the_json_url_field_and_use')}</p>
              <p>{t('ui.app.send_the_token_to_the_save_api_below_do')}</p>
              <p>{t('ui.app.project_id_is_optional_if_omitted_a_project_restricted')}</p>
              <details>
                <summary>{t('ui.app.choose_a_destination_when_running_the_shortcut')}</summary>
                <p>{t('ui.app.get_the_following_url_with_the_same_authorization_header')}</p>
                <code>{base}/api/v1/projects</code>
              </details>
            </div>
          </li>
        </ol>
        <figure className="shortcut-setup-figure">
          <figcaption>{t('ui.app.shortcut_setup_example')}</figcaption>
          <img
            src={shortcutSetupImage}
            width={881}
            height={1785}
            loading="lazy"
            decoding="async"
            alt={t('ui.app.receive_urls_and_safari_web_pages_from_the_share')}
          />
          <p>{t('ui.app.use_the_following_url_for_the_save_api_url')}</p>
          <code>{base}/api/v1/stocks</code>
        </figure>
        <div className="api-example">
          <div>
            <span>POST</span>
            <code>{base}/api/v1/stocks</code>
            <button
              className="icon-button small"
              aria-label={t('ui.app.copy_save_api_url')}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${base}/api/v1/stocks`);
                  setCopied(true);
                  setCopyError('');
                } catch {
                  setCopyError(t('ui.app.could_not_copy_select_and_copy_the_displayed_url'));
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          <pre id="shortcut-body-example">
            {t('ui.app.authorization_bearer_lt_your_token_gt')}
            {'\n'}Content-Type: application/json
            {'\n\n'}
            {example}
          </pre>
        </div>
        <FormError error={copyError} />
        <label htmlFor="shortcut-project">{t('ui.app.example_destination_optional')}</label>
        <select
          id="shortcut-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">{t('ui.app.unspecified_use_the_token_s_settings')}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <p className="guide-note">{t('ui.app.selecting_a_project_puts_its_actual_id_in_the')}</p>
        <p className="guide-note">{t('ui.app.the_api_returns_an_id_when_a_save_is')}</p>
      </section>
      <section className="token-section">
        <div className="section-head">
          <div>
            <h2>{t('ui.app.integration_tokens')}</h2>
            <p>{t('ui.app.tokens_allow_listing_projects_and_saving_articles')}</p>
          </div>
          <button className="button primary" onClick={onCreate}>
            <Plus size={17} aria-hidden="true" />
            {t('ui.app.create_token')}
          </button>
        </div>
        {!tokens.length ? (
          <div className="token-empty">
            <KeyRound size={25} aria-hidden="true" />
            <p>{t('ui.app.no_tokens_have_been_created')}</p>
          </div>
        ) : (
          <div className="token-list">
            {tokens.map((token) => {
              const inactive =
                Boolean(token.revoked_at) ||
                (token.expires_at !== null && new Date(token.expires_at).getTime() <= Date.now());
              return (
                <div className={`token-row ${inactive ? 'token-inactive' : ''}`} key={token.id}>
                  <KeyRound size={19} aria-hidden="true" />
                  <div>
                    <strong>{token.name}</strong>
                    <code>{token.prefix}••••••••</code>
                    <span>
                      {projects.find((project) => project.id === token.project_id)?.name ??
                        t('ui.app.all_projects')}{' '}
                      ·{' '}
                      {inactive
                        ? token.revoked_at
                          ? t('ui.app.revoked')
                          : t('ui.app.expired')
                        : token.expires_at === null
                          ? t('ui.app.no_expiration')
                          : t('ui.app.valid_until_value', { value0: date(token.expires_at) })}
                    </span>
                    {token.last_used_at && (
                      <small>
                        {t('ui.app.last_used')}
                        {fullDate(token.last_used_at)}
                      </small>
                    )}
                  </div>
                  <button
                    className="button secondary"
                    disabled={inactive}
                    onClick={() => {
                      if (
                        window.confirm(
                          t('ui.app.revoke_this_token_configured_shortcuts_will_no_longer_be'),
                        )
                      )
                        void onRevoke(token.id);
                    }}
                  >
                    {t('ui.app.revoke')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
function TokenForm({ projects }: { projects: Project[] }) {
  useLanguage();
  const [name, setName] = useState('iPhone');
  const [project, setProject] = useState('');
  const [days, setDays] = useState<number | null>(90);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  if (token)
    return (
      <div className="new-token">
        <div className="token-created">
          <Check size={24} aria-hidden="true" />
          <h3>{t('ui.app.token_created')}</h3>
        </div>
        <p>{t('ui.app.the_complete_token_is_shown_only_here_register_it')}</p>
        <label htmlFor="new-token-value">{t('ui.app.bearer_token')}</label>
        <textarea id="new-token-value" value={token} readOnly rows={3} />
        <button
          className="button primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token);
              setCopied(true);
              setError('');
            } catch {
              setError(t('ui.app.could_not_copy_select_and_copy_the_token'));
            }
          }}
        >
          {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
          {copied ? t('ui.app.copied') : t('ui.app.copy_token')}
        </button>
        <FormError error={error} />
      </div>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          const result = await send<{
            token: string;
          }>('/api/v1/tokens', {
            name,
            project_id: project || null,
            expires_days: days,
          });
          setToken(result.token);
        } catch (e) {
          setError(applicationError((e as Error).message));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="form-intro">{t('ui.app.create_a_token_for_each_device_or_purpose_so')}</p>
      <label htmlFor="token-name">{t('ui.app.token_name')}</label>
      <input
        id="token-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
      />
      <label htmlFor="token-project">{t('ui.app.destination_restriction')}</label>
      <select id="token-project" value={project} onChange={(e) => setProject(e.target.value)}>
        <option value="">{t('ui.app.all_my_projects')}</option>
        {projects.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <label htmlFor="token-days">{t('ui.app.validity_period')}</label>
      <select
        id="token-days"
        value={days ?? 'unlimited'}
        onChange={(e) => setDays(e.target.value === 'unlimited' ? null : Number(e.target.value))}
      >
        <option value={30}>{t('ui.app.30_days')}</option>
        <option value={90}>{t('ui.app.90_days')}</option>
        <option value={365}>{t('ui.app.365_days')}</option>
        <option value="unlimited">{t('ui.app.no_expiration')}</option>
      </select>
      <FormError error={error} />
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          {busy ? <Spinner /> : <KeyRound size={17} aria-hidden="true" />}
          {t('ui.app.create')}
        </button>
      </div>
    </form>
  );
}
