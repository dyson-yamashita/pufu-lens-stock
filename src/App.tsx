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
import Questions, { StockQuestion } from './Questions';
import QuestionForm from './QuestionForm';
import SearchField from './SearchField';
import QuestionPage from './QuestionPage';
import PufuPage from './PufuPage';
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
const headerLabels: Record<Route['view'], string> = {
  stocks: 'ストック',
  questions: '問い・気づき',
  pufus: 'プ譜',
  memory: 'メモリ',
  settings: '設定',
  profile: 'プロフィール',
  mcp: '外部連携',
  shortcuts: 'ショートカット',
  question: '詳細',
  resolve: 'プ譜を作成',
  pufu: 'プ譜',
};
const globalHeaderLabels: Partial<Record<Route['view'], string>> = {
  stocks: 'すべてのストック',
  questions: 'すべての問い・気づき',
  pufus: 'すべてのプ譜',
  memory: 'あなたのメモリ',
};
type ModalState =
  | { type: 'project'; project?: Project }
  | { type: 'save' }
  | { type: 'stock'; stock: Stock; tab?: 'question' }
  | { type: 'token' }
  | { type: 'question' }
  | { type: 'memory'; projectId: string | null }
  | null;
const statusLabels = {
  queued: '処理待ち',
  extracting: '本文を取得中',
  summarizing: '要約を生成中',
  ready: '要約済み',
  failed: '取得失敗',
};
const date = (value: string) =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
const fullDate = (value: string) =>
  new Intl.DateTimeFormat('ja-JP', {
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
  return (
    <a className="brand" href="#" aria-label="Pufu Lens ホーム">
      <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
      <span>Pufu Lens</span>
    </a>
  );
}
function Spinner() {
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
        <button className="icon-button" onClick={onClose} aria-label="閉じる">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function FormError({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
function Login({ config, onLogin }: { config: Config; onLogin: () => Promise<void> }) {
  const withdrawn = new URLSearchParams(window.location.search).get('withdrawn');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    new URLSearchParams(window.location.search).has('login_error')
      ? 'Googleログインを完了できませんでした。もう一度お試しください。'
      : '',
  );
  return (
    <div className="login-page">
      <header>
        <Brand />
        <div className="login-header-links">
          <span className="login-caption">読む。集める。つながる。</span>
          <a className="text-link" href="/manual">
            <BookOpen size={17} aria-hidden="true" />
            マニュアル
          </a>
        </div>
      </header>
      <main className="login-main">
        <div className="login-copy">
          <h1>
            集めた知識を、
            <br />
            つながる<span>記憶</span>に。
          </h1>
          <p>
            気になった記事を、プロジェクトへ。
            <br />
            記事の要点も、あなたの関心も、
            <br />
            少しずつひとつのメモリに育てます。
          </p>
          <a
            className={`button primary google-button ${!config.googleConfigured ? 'disabled' : ''}`}
            href={config.googleConfigured ? '/api/auth/google' : undefined}
            aria-disabled={!config.googleConfigured}
          >
            <span className="google-g" aria-hidden="true">
              G
            </span>
            Googleでログイン
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          {!config.googleConfigured && (
            <p className="login-help">
              {config.demo
                ? 'ローカルでは、デモでアプリをお試しいただけます。'
                : 'ログインの準備中です。管理者にお問い合わせください。'}
            </p>
          )}
          <div className="login-legal">
            <p>利用開始前に、以下をご確認・ご同意ください。</p>
            <LegalLinks />
          </div>
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
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : <BookOpen size={18} aria-hidden="true" />}ローカルデモを開く
            </button>
          )}
          {['complete', 'pending'].includes(withdrawn ?? '') && (
            <p className="withdrawal-notice" role="status">
              {withdrawn === 'pending'
                ? config.demo
                  ? '退会しました。残りのデモデータは、次回デモ開始時にも削除を進めます。'
                  : '退会しました。残りのデータの削除は自動で継続します。'
                : '退会が完了し、登録したデータを削除しました。'}
            </p>
          )}
          <FormError error={error} />
          <div className="login-features">
            <span>
              <Folder size={17} aria-hidden="true" />
              プロジェクトで整理
            </span>
            <span>
              <Sparkles size={17} aria-hidden="true" />
              記事からメモリへ
            </span>
          </div>
        </div>
        <div className="login-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-tag">
            <Bookmark size={16} />
            読んだ先に、つながりがある。
          </div>
          <div className="art-article">
            <h3>
              明日のアイデアにつながる、
              <br />
              今日のひと記事。
            </h3>
            <div className="art-rule" />
            <div className="art-rule short" />
            <div className="art-tags">
              <span>気になること</span>
              <span>新しい視点</span>
            </div>
          </div>
          <div className="art-memory">
            <div className="art-memory-icon">
              <Sparkles size={21} />
            </div>
            <div>
              <h3>関心と知識が、少しずつ育つ。</h3>
              <p>保存した記事から、テーマと論点を整理。</p>
            </div>
            <ArrowUpRight size={20} />
          </div>
          <span className="art-dot dot-one" />
          <span className="art-dot dot-two" />
        </div>
      </main>
      <PublicProjectDirectory />
      <footer className="login-footer">
        <LegalLinks />
      </footer>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [questionListContext, setQuestionListContext] = useState({
    view: 'questions' as 'questions' | 'pufus',
    projectId: null as string | null,
    scope: null as string | null,
    hash: '#questions',
    scroll: 0,
  });
  const navigationGuard = useRef<(() => boolean) | null>(null);
  const previousHash = useRef(window.location.hash);
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
    const listener = () => {
      if (navigationGuard.current && !navigationGuard.current()) {
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${window.location.search}${previousHash.current}`,
        );
        return;
      }
      previousHash.current = window.location.hash;
      setRoute(routeFromHash());
      setPage(1);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
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
      api<{ user: User }>('/api/v1/me').catch((e) => {
        if ((e as ApiError).status !== 401) throw e;
        return { user: null };
      }),
    ])
      .then(([settings, identity]) => {
        if (active) {
          setConfig(settings);
          setUser(identity.user);
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!user) return;
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
          api<{ projects: Project[] }>('/api/v1/projects', { signal: controller.signal }),
          api<{ stocks: Stock[]; total: number }>(`/api/v1/stocks?${params}`, {
            signal: controller.signal,
          }),
          api<MemoryResponse>(
            `/api/v1/memory${route.projectId ? `?project_id=${encodeURIComponent(route.projectId)}` : ''}`,
            { signal: controller.signal },
          ),
          route.view === 'shortcuts'
            ? api<{ tokens: TokenInfo[] }>('/api/v1/tokens', { signal: controller.signal })
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
        else setError((e as Error).message);
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
      const { stock } = await api<{ stock: Stock }>(
        `/api/v1/articles/${encodeURIComponent(articleId)}`,
      );
      setModal({ type: 'stock', stock });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!config || user === undefined)
    return (
      <div className="boot">
        <Brand />
        <p>{error || '知識の棚を開いています…'}</p>
        {!error && <Spinner />}
      </div>
    );
  if (!user)
    return (
      <Login
        config={config}
        onLogin={async () => {
          await send('/api/auth/demo');
          const data = await api<{ user: User }>('/api/v1/me');
          setUser(data.user);
        }}
      />
    );
  const heading =
    route.view === 'settings'
      ? selected
        ? `${selected.name}の設定`
        : 'プロジェクト設定'
      : route.view === 'questions'
        ? selected
          ? `${selected.name}の問い・気づき`
          : 'すべての問い・気づき'
        : route.view === 'pufus'
          ? selected
            ? `${selected.name}のプ譜`
            : 'すべてのプ譜'
          : route.view === 'profile'
            ? 'プロフィール'
            : route.view === 'mcp'
              ? '外部連携'
              : route.view === 'shortcuts'
                ? 'ショートカット連携'
                : route.view === 'memory'
                  ? selected
                    ? `${selected.name}のメモリ`
                    : 'あなたのメモリ'
                  : (selected?.name ?? 'すべてのストック');
  const questionListProject = projects.find(
    (project) => project.id === questionListContext.projectId,
  );
  const listLabel = questionListContext.view === 'pufus' ? 'プ譜' : '問い・気づき';
  const questionListHeading = questionListProject
    ? `${questionListProject.name}の${listLabel}`
    : `すべての${listLabel}`;
  const headerProjectId = questionFlow ? questionListContext.projectId : route.projectId;
  const headerProject = questionFlow ? questionListProject : selected;
  const headerLabel = headerProjectId
    ? headerLabels[route.view]
    : (globalHeaderLabels[route.view] ?? headerLabels[route.view]);
  const listedProjects = projects.filter((project) => project.show_in_all_lists !== false);
  const allCount = listedProjects.reduce((count, project) => count + project.count, 0);
  const allQuestionCount = listedProjects.reduce(
    (count, project) => count + project.question_count,
    0,
  );
  return (
    <div className={`app-shell ${!isMobile && desktopNavCollapsed ? 'sidebar-collapsed' : ''}`}>
      {isMobile && mobileNav && (
        <button
          className="nav-scrim"
          aria-label="メニューを閉じる"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? 'nav-open' : ''}`} id="sidebar" inert={!sidebarOpen}>
        <Brand />
        <button
          id="sidebar-close"
          className="icon-button sidebar-close"
          aria-label="メニューを閉じる"
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
        <nav aria-label="メインナビゲーション">
          <button
            className={`nav-item ${route.view === 'stocks' && !route.projectId ? 'active' : ''}`}
            aria-current={route.view === 'stocks' && !route.projectId ? 'page' : undefined}
            onClick={() => {
              filterProject(null);
              navigate('stocks');
            }}
          >
            <Layers size={19} aria-hidden="true" />
            すべてのストック<span className="nav-count">{allCount}</span>
          </button>
          <button
            className={`nav-item ${(route.view === 'questions' && !route.projectId) || questionFlow ? 'active' : ''}`}
            aria-current={
              (route.view === 'questions' && !route.projectId) || questionFlow ? 'page' : undefined
            }
            onClick={() => {
              filterProject(null);
              navigate('questions');
            }}
          >
            <CircleHelp size={19} aria-hidden="true" />
            すべての問い・気づき<span className="nav-count">{allQuestionCount}</span>
          </button>
          <button
            className={`nav-item ${route.view === 'memory' && !route.projectId ? 'active' : ''}`}
            onClick={() => navigate('memory')}
          >
            <Sparkles size={19} aria-hidden="true" />
            あなたのメモリ
          </button>
          <div className="nav-section">
            <span>プロジェクト</span>
            <button
              className="icon-button small"
              aria-label="プロジェクトを作成"
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
              最初のプロジェクトを
              <br />
              つくってみましょう。
            </p>
          )}
          <button className="new-project" onClick={() => setModal({ type: 'project' })}>
            <Plus size={17} aria-hidden="true" />
            プロジェクトを追加
          </button>
        </nav>
        <div className="sidebar-bottom">
          <a
            className="nav-item"
            href="/manual"
            target="_blank"
            rel="noreferrer"
            aria-label="ユーザーマニュアル（新しいタブで開く）"
          >
            <BookOpen size={18} aria-hidden="true" />
            ユーザーマニュアル
          </a>
          <button
            className={`nav-item ${route.view === 'profile' ? 'active' : ''}`}
            aria-current={route.view === 'profile' ? 'page' : undefined}
            onClick={() => navigate('profile')}
          >
            <UserRound size={18} aria-hidden="true" />
            プロフィール
          </button>
          <button
            className={`nav-item ${route.view === 'shortcuts' ? 'active' : ''}`}
            onClick={() => navigate('shortcuts')}
          >
            <KeyRound size={18} aria-hidden="true" />
            ショートカット連携
          </button>
          <button
            className={`nav-item ${route.view === 'mcp' ? 'active' : ''}`}
            aria-current={route.view === 'mcp' ? 'page' : undefined}
            onClick={() => navigate('mcp')}
          >
            <Layers size={18} aria-hidden="true" />
            外部連携
          </button>
          <div className="user-row">
            <div className="avatar">{user.name.slice(0, 1)}</div>
            <div className="user-info">
              <strong>{user.name}</strong>
              <span>{config.demo ? 'ローカルデモ' : user.email}</span>
            </div>
            <button
              className="icon-button"
              aria-label="ログアウト"
              onClick={async () => {
                try {
                  await send('/api/v1/logout');
                  setUser(null);
                } catch (e) {
                  setError((e as Error).message);
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
              aria-label="メニューを開く"
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
          <nav className="breadcrumb" aria-label="パンくずリスト">
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
              トップ
            </a>{' '}
            <span aria-hidden="true">/</span>{' '}
            {headerProjectId && (
              <>
                <a
                  className="breadcrumb-project"
                  href={`#project/${encodeURIComponent(headerProjectId)}`}
                  title={headerProject?.name ?? 'プロジェクト'}
                >
                  <span className="breadcrumb-project-name">
                    {headerProject?.name ?? 'プロジェクト'}
                  </span>
                </a>{' '}
                <span aria-hidden="true">/</span>{' '}
              </>
            )}
            {questionFlow ? (
              <>
                <a href={questionListContext.hash} title={questionListHeading}>
                  {headerProjectId ? listLabel : `すべての${listLabel}`}
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
                ? 'ローカルデモ · サンプル記事を含みます。新しいストックのAI生成にはWorkers AIを使用します。'
                : 'ローカルデモ · サンプル記事を含みます。新しい記事の要約はAI未接続の本文抜粋です。'}
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
                      ? '日常やストックから生まれた問い・気づきを集める。'
                      : route.view === 'pufus'
                        ? '問い・気づきから生まれた解決の案を、一覧で振り返る。'
                        : route.view === 'settings'
                          ? 'プロジェクトの設定を編集できます。'
                          : route.view === 'mcp'
                            ? '会話から、ストックと問い・気づきにつなげる。'
                            : route.view === 'shortcuts'
                              ? 'iPhoneで見つけた記事を、プロジェクトへそのままストック。'
                              : route.view === 'memory'
                                ? '集めた記事から見えてきた関心と知識。根拠とともに、少しずつ更新されます。'
                                : selected?.description ||
                                  '気になった記事と、生まれたアイデアをひとつの場所に。'}
                  </p>
                )}
              </div>
              <div className="header-actions">
                {libraryView && (
                  <div className="header-project-select">
                    <label htmlFor="project-scope">プロジェクト</label>
                    <div className="project-select-control">
                      <select
                        id="project-scope"
                        value={libraryProjectId ?? ''}
                        onChange={(event) => filterProject(event.target.value || null)}
                      >
                        <option value="">すべてのプロジェクト</option>
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
                    {projects.length ? '記事をストック' : 'プロジェクトを作成'}
                  </button>
                )}
                {route.view === 'questions' && (
                  <button className="button primary" onClick={() => setModal({ type: 'question' })}>
                    <Plus size={18} aria-hidden="true" />
                    問い・気づきを追加
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
              aria-label={route.projectId ? 'プロジェクトの表示内容' : '全体の表示内容'}
            >
              <button
                className={route.view === 'stocks' ? 'active' : ''}
                aria-pressed={route.view === 'stocks'}
                onClick={() => navigate('stocks', route.projectId)}
              >
                <Bookmark size={16} aria-hidden="true" />
                ストック
              </button>
              <button
                className={route.view === 'questions' ? 'active' : ''}
                aria-pressed={route.view === 'questions'}
                onClick={() => navigate('questions', route.projectId)}
              >
                <CircleHelp size={16} aria-hidden="true" />
                問い・気づき
              </button>
              <button
                className={route.view === 'pufus' ? 'active' : ''}
                aria-pressed={route.view === 'pufus'}
                onClick={() => navigate('pufus', route.projectId)}
              >
                <Network size={16} aria-hidden="true" />
                プ譜
              </button>
              <button
                className={route.view === 'memory' ? 'active' : ''}
                aria-pressed={route.view === 'memory'}
                onClick={() => navigate('memory', route.projectId)}
              >
                <Sparkles size={16} aria-hidden="true" />
                メモリ
              </button>
              {route.projectId && (
                <button
                  className={route.view === 'settings' ? 'active' : ''}
                  aria-pressed={route.view === 'settings'}
                  onClick={() => navigate('settings', route.projectId)}
                >
                  <Settings size={16} aria-hidden="true" />
                  設定
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
                再読み込み
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
                  const { stock } = await api<{ stock: Stock }>(`/api/v1/stocks/${id}`);
                  setModal({ type: 'stock', stock, tab: 'question' });
                }}
              />
            </div>
          )}
          {(route.view === 'pufus' || (questionFlow && questionListContext.view === 'pufus')) && (
            <div hidden={route.view !== 'pufus'}>
              <Pufus
                key={(questionFlow ? questionListContext.scope : listProjectId) ?? 'all'}
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
                onGuard={setNavigationGuard}
              />
            ) : (
              <QuestionPage
                key={route.detailId}
                id={route.detailId!}
                projects={projects}
                resolve={route.view === 'resolve'}
                onUpdated={reload}
                backLabel={`${listLabel}の一覧に戻る`}
                onBack={() => {
                  if (route.view === 'resolve') navigateDetail('question', route.detailId!);
                  else window.location.hash = questionListContext.hash;
                }}
                onResolve={() => navigateDetail('resolve', route.detailId!)}
                onPufu={(id) => navigateDetail('pufu', id)}
                onDeleted={() => {
                  setNotice('問い・気づきを削除しました。');
                  reload();
                  window.location.hash = questionListContext.hash;
                }}
                onStock={async (id) => {
                  const { stock } = await api<{ stock: Stock }>(
                    `/api/v1/stocks/${encodeURIComponent(id)}`,
                  );
                  setModal({ type: 'stock', stock });
                }}
              />
            )
          ) : route.view === 'settings' ? (
            <section className="project-settings" aria-label="プロジェクト設定">
              {selected ? (
                <ProjectForm
                  key={selected.id}
                  project={selected}
                  onDone={() => completed('プロジェクトの設定を保存しました。')}
                  onDelete={() => {
                    completed('プロジェクトを削除しました。');
                    filterProject(null);
                    navigate('stocks');
                  }}
                />
              ) : (
                <p className="content-loading">
                  <Spinner />
                  プロジェクトを読み込んでいます…
                </p>
              )}
            </section>
          ) : route.view === 'questions' || route.view === 'pufus' ? null : route.view ===
            'profile' ? (
            <Profile
              user={user}
              onSave={(savedUser) => {
                setUser(savedUser);
                setNotice('プロフィールを保存しました。');
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
                  setNotice('トークンを失効しました。');
                  reload();
                } catch (e) {
                  setError((e as Error).message);
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
              <section className="stock-section" aria-label="保存した記事">
                <SearchField
                  label="記事を検索"
                  placeholder="タイトル、要約、メモから検索"
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
                  <div className="filters" aria-label="ストックのフィルター">
                    {[
                      ['all', 'すべて'],
                      ['web', 'web'],
                      ['user', 'テキスト'],
                      ['favorites', 'お気に入り'],
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
                  <span className="result-count">{total}件</span>
                </div>
                {loading && !stocks.length ? (
                  <div className="empty-state">
                    <Spinner />
                    <p>記事を読み込んでいます。</p>
                  </div>
                ) : !stocks.length ? (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Bookmark size={28} aria-hidden="true" />
                    </span>
                    <h2>
                      {search || stockSource !== 'all'
                        ? '該当する記事はありません'
                        : 'ここから、知識が育ちはじめます'}
                    </h2>
                    <p>
                      {search || stockSource !== 'all'
                        ? '検索語やフィルターを変えてお試しください。'
                        : 'URLやテキストを保存してみましょう。要約とメモリは自動で更新されます。'}
                    </p>
                    {!search && stockSource === 'all' && (
                      <button
                        className="button primary"
                        onClick={() =>
                          setModal(projects.length ? { type: 'save' } : { type: 'project' })
                        }
                      >
                        <Plus size={17} aria-hidden="true" />
                        {projects.length ? '最初の記事をストック' : 'プロジェクトを作成'}
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
                          void toggleStockFavorite(stock).catch((e: Error) => setError(e.message));
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
                      前へ
                    </button>
                    <span>
                      {page} / {Math.ceil(total / 24)}
                    </span>
                    <button
                      className="button secondary"
                      disabled={page * 24 >= total}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      次へ
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
        <Modal title="メモリの更新方法" onClose={() => setModal(null)}>
          <MemoryRebuildForm
            projectId={modal.projectId}
            projectName={projects.find((project) => project.id === modal.projectId)?.name}
            onClose={() => setModal(null)}
            onDone={() => completed('メモリの更新を受け付けました。')}
          />
        </Modal>
      )}
      {modal?.type === 'project' && (
        <Modal
          title={modal.project ? 'プロジェクトを編集' : '新しいプロジェクト'}
          onClose={() => setModal(null)}
        >
          <ProjectForm
            project={modal.project}
            onDone={(id) => {
              completed(
                modal.project ? 'プロジェクトを更新しました。' : 'プロジェクトを作成しました。',
              );
              navigate('stocks', id);
            }}
            onDelete={() => {
              completed('プロジェクトを削除しました。');
              navigate('stocks');
            }}
          />
        </Modal>
      )}
      {modal?.type === 'save' && (
        <Modal title="記事をストック" onClose={() => setModal(null)}>
          <SaveForm
            projects={projects}
            projectId={listProjectId}
            onDone={(duplicate, youtube) =>
              completed(
                youtube
                  ? 'YouTubeのURLを保存しました。'
                  : duplicate
                    ? 'この記事はすでに保存されています。'
                    : '記事を保存しました。要約を自動で生成します。',
              )
            }
          />
        </Modal>
      )}
      {modal?.type === 'question' && (
        <Modal title="問い・気づきを追加" onClose={() => setModal(null)}>
          <QuestionForm
            projects={projects}
            projectId={listProjectId}
            onDone={(projectId) => {
              completed('問い・気づきを追加しました。');
              setQuestionCreation((value) => value + 1);
              if (route.projectId) navigate('questions', projectId);
              else if (libraryProjectId) filterProject(projectId);
            }}
          />
        </Modal>
      )}
      {modal?.type === 'stock' && (
        <Modal title="ストックした記事" wide onClose={() => setModal(null)}>
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
          title="ショートカット用トークンを発行"
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
          {stock.source_type === 'text' ? 'テキスト' : stock.domain.replace('www.', '')}
        </span>
        {stock.status !== 'ready' && !youtube && (
          <span className={`status status-${stock.status}`}>
            {stock.status !== 'failed' && <span className="status-dot" />}
            {statusLabels[stock.status]}
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
            ? 'YouTubeのリンクを保存しています。詳細から動画や元のページを開けます。'
            : (stock.summary?.overview ??
              stock.error ??
              (stock.source_type === 'text'
                ? '保存したテキストから、要点をまとめています。'
                : '記事本文を取得して、要点をまとめています。保存したURLはいつでも開けます。'))}
        </p>
      </div>
      {youtube && (
        <button
          type="button"
          className="youtube-thumbnail"
          aria-label={`${youtubeDisplayTitle(stock.title)}の詳細を開く`}
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
          {new Intl.DateTimeFormat('ja-JP', {
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
  return (
    <button
      type="button"
      className="stock-favorite"
      aria-label={stock.is_favorite ? 'お気に入りを解除' : 'お気に入りに追加'}
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
      {showLabel && <span>お気に入り</span>}
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
          <h2>{project ? 'プロジェクトのメモリ' : 'あなたのメモリ'}</h2>
        </div>
        {response.pending && (
          <span className="memory-pending" aria-label="メモリを更新中">
            <Spinner />
          </span>
        )}
      </div>
      <p className="memory-caption">
        {project ? 'このプロジェクトで集めた記事から。' : '対象のプロジェクトを横断した関心。'}
      </p>
      {response.coverage?.full_rebuild_reason && (
        <p className="update-note">{response.coverage.full_rebuild_reason}</p>
      )}
      {response.pending && <p className="update-note">新しい記事を反映しています…</p>}
      {response.error && (
        <p className="form-error" role="alert">
          {response.error}
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
            記事の要約が増えると、
            <br />
            関心と知識がここにつながります。
          </p>
        </div>
      ) : (
        <>
          <div className="memory-block">
            <h3>
              <span />
              興味の傾向
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
              記事から得た知識
            </h3>
            <ul>
              {data.knowledge.slice(0, full ? 12 : 2).map((item, index) => (
                <li key={index}>
                  <MemoryKnowledge text={item.text}>
                    {item.articleIds.slice(0, full ? 5 : 1).map((id, sourceIndex) => (
                      <button key={id} onClick={() => void onEvidence(id)}>
                        ストックした記事{item.articleIds.length > 1 ? ` ${sourceIndex + 1}` : ''}
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
              <h3>未解決の論点</h3>
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
            ? `${memory.article_count}記事から生成 · ${date(memory.updated_at)}更新`
            : '記事の要約後に更新'}
        </span>
      </div>
      {full && (
        <>
          <p className="memory-disclaimer">
            記事の保存は、その主張への賛同を意味しません。ここには、保存の傾向と記事から収集した情報を整理しています。
          </p>
          <div className="memory-controls">
            <button className="button secondary" disabled={response.pending} onClick={onRebuild}>
              <RefreshCw size={16} aria-hidden="true" />
              再生成
            </button>
            {memory && (
              <button
                className="button secondary"
                onClick={() => {
                  const blob = new Blob([memory.text], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${project?.name ?? 'ユーザー'}-メモリ.txt`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <ArrowDownToLine size={16} aria-hidden="true" />
                テキストを保存
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
            const data = await send<{ id: string }>(
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
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="form-intro">
          {project
            ? 'プロジェクト名と概要を変更できます。内容はメモリの整理にも使われます。'
            : '集めたいテーマに名前をつけましょう。目的を書くと、メモリの整理にも使われます。'}
        </p>
        {project && (
          <>
            <dl className="project-id">
              <dt>プロジェクトID</dt>
              <dd className="project-id-row">
                <span className="project-id-value">{project.id}</span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="プロジェクトIDをコピー"
                  title="プロジェクトIDをコピー"
                  onClick={async () => {
                    setIdCopied(false);
                    setIdCopyError('');
                    try {
                      await navigator.clipboard.writeText(project.id);
                      setIdCopied(true);
                    } catch {
                      setIdCopyError(
                        'コピーできませんでした。プロジェクトIDを選択してコピーしてください。',
                      );
                    }
                  }}
                >
                  <Copy size={16} aria-hidden="true" />
                </button>
              </dd>
            </dl>
            <p className="guide-note" role="status">
              {idCopied && 'プロジェクトIDをコピーしました。'}
            </p>
            <FormError error={idCopyError} />
          </>
        )}
        <label htmlFor={nameId}>プロジェクト名</label>
        <input
          id={nameId}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          autoFocus
          placeholder="例：次のアプリ開発"
        />
        <label htmlFor={descriptionId}>
          プロジェクト概要 <span className="optional">任意</span>
        </label>
        <textarea
          id={descriptionId}
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={8}
          placeholder={`以下について書いてみましょう。

・実現したいこと、取り組む目的
・使える時間や予算
・利用できる技術や道具、活動環境
・競合する活動、気になる問題`}
        />
        <details className="project-advanced">
          <summary>詳細設定</summary>
          <label className="project-memory-toggle" htmlFor={listVisibilityId}>
            <span>すべてのストック・問い・気づき・プ譜の一覧に表示する</span>
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
            オフにすると、このプロジェクトのストック・問い・気づき・プ譜を全体の一覧から外します。プロジェクトを指定すると表示できます。メモリの更新設定や公開設定には影響しません。
          </p>
          <label className="project-memory-toggle" htmlFor={userMemoryId}>
            <span>ストック追加時にユーザーのメモリを更新する</span>
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
            オフでもプロジェクトのメモリは更新します。このプロジェクトの記事は「あなたのメモリ」の生成対象から外れます。
            {project && '保存すると、既存のメモリにも変更を反映します。'}
          </p>
          <label className="project-memory-toggle" htmlFor={autoQuestionsId}>
            <span>ストックから問い・気づきを自動生成する</span>
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
            オフにすると、このプロジェクトのストックから問い・気づきを自動生成しません。生成済みの問い・気づきは残り、手動で問い・気づきを追加できます。要約とメモリの更新設定は変わりません。
          </p>
        </details>
        <FormError error={error} />
        <div className="form-actions">
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Check size={17} aria-hidden="true" />}
            {project ? '保存' : 'プロジェクトを作成'}
          </button>
        </div>
      </form>
      {project && (
        <>
          <ProjectPublicationSettings key={project.id} projectId={project.id} />
          <DeleteAction
            summary="プロジェクトの削除"
            label="プロジェクトを削除"
            title="プロジェクトを削除しますか？"
            disabled={busy}
            onDelete={async () => {
              await api(`/api/v1/projects/${project.id}`, { method: 'DELETE' });
              onDelete();
            }}
          >
            <p className="delete-target">{project.name}</p>
            <p>
              このプロジェクトのストック・問い・気づき・プ譜（すべての局面）・コメント・メモリを削除します。他のプロジェクトに保存した記事は残ります。
            </p>
            <p>公開中の場合は公開ページも閲覧できなくなります。この操作は取り消せません。</p>
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
              ? '本文を入力してください。'
              : '入力内容を確認してください。文字数または形式が正しくありません。',
          );
          document.getElementById(type !== 'url' ? 'stock-text' : 'stock-url')?.focus();
          return;
        }
        setBusy(true);
        try {
          const result = await api<{ duplicate: boolean }>('/api/v1/stocks', {
            method: 'POST',
            headers: { 'Idempotency-Key': key.current },
            body: JSON.stringify(parsed.data),
          });
          onDone(result.duplicate, parsed.data.type === 'url' && isYouTubeUrl(parsed.data.url));
        } catch (e) {
          setError((e as Error).message);
          if ((e as ApiError).status === 409) key.current = createRequestId();
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="form-intro">
        URL・テキストを保存すると、要約を生成し、メモリを自動で更新します。
        {projects.find((project) => project.id === target)?.auto_generate_questions !== false &&
          '問い・気づきも自動で生成します。'}
      </p>
      <div
        className="stock-source-tabs"
        role="tablist"
        aria-label="種別"
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
            ['text', 'テキスト'],
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
        <label htmlFor="stock-project">保存先プロジェクト</label>
        <select
          id="stock-project"
          value={target}
          disabled={busy || !projects.length}
          onChange={(e) => {
            setTarget(e.target.value);
            key.current = createRequestId();
          }}
        >
          {!target && <option value="">プロジェクトを選択してください</option>}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {type === 'url' ? (
          <>
            <label htmlFor="stock-url">投稿URL</label>
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
            <p className="profile-hint">Xは「外部連携」でBearer Tokenを登録すると取得できます。</p>
          </>
        ) : (
          <>
            <label htmlFor="stock-text">本文</label>
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
              placeholder="ストックしたい文章を入力、または貼り付けてください"
            />
            <p id="stock-text-hint" className="profile-hint profile-bio-hint">
              <span>20,000文字まで。</span>
              <span>{text.length.toLocaleString()} / 20,000</span>
            </p>
          </>
        )}
        <details className="stock-details">
          <summary>
            詳細
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          {type === 'text' && (
            <>
              <label htmlFor="stock-text-title">
                タイトル <span className="optional">任意</span>
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
                placeholder="未入力の場合は本文の先頭行から付けます"
              />
            </>
          )}
          <label htmlFor="stock-note">
            メモ <span className="optional">任意</span>
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
            placeholder="気になった理由、あとで考えたいことなど"
          />
        </details>
      </div>
      <FormError error={error} />
      <div className="form-actions">
        <button className="button primary" disabled={busy || !target}>
          {busy ? <Spinner /> : <Bookmark size={17} aria-hidden="true" />}
          {busy ? '保存中…' : 'ストックする'}
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
      void api<{ content: string | null }>(`/api/v1/stocks/${stock.id}/content`)
        .then((result) => {
          if (active) setContent(result.content);
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        });
    return () => {
      active = false;
    };
  }, [tab, content, stock.id]);
  return (
    <div className="stock-detail">
      <div className="detail-domain">
        {stock.source_type === 'text' ? 'テキスト' : stock.domain}{' '}
        {stock.status !== 'ready' && !youtube && (
          <span className={`status status-${stock.status}`}>{statusLabels[stock.status]}</span>
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
              setTitleError((e as Error).message);
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
          <label htmlFor={titleId}>タイトル</label>
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
              キャンセル
            </button>
            <button className="button primary" disabled={busy || !title.trim()}>
              {busy ? <Spinner /> : <Check size={16} aria-hidden="true" />}
              {busy ? '保存中…' : '保存'}
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
            aria-label="タイトルを編集"
            title="タイトルを編集"
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
            {youtube ? 'YouTubeで開く' : '元の記事を開く'}
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
              setError((e as Error).message);
            }
          }}
        />
      </div>
      <div className="detail-tabs" aria-label="記事の表示内容">
        {(youtube
          ? [
              ['summary', '動画'],
              ['comments', 'コメント'],
              ['note', 'メモ・保存先'],
            ]
          : [
              ['summary', '要約'],
              ['question', '問い・気づき'],
              ['comments', 'コメント'],
              ['note', 'メモ・保存先'],
              ['content', stock.source_type === 'text' ? '入力した本文' : '取得した本文'],
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
                  <p>短い本文のため、推測を加えず原文を表示しています。</p>
                  {!stock.note.trim() && (
                    <>
                      <p>なぜ気になったかを一言残すと、問い・気づきとメモリに反映されます。</p>
                      <button className="button secondary" onClick={() => setTab('note')}>
                        ひとことメモを残す
                      </button>
                    </>
                  )}
                </div>
              )}
              <h4>この記事の要点</h4>
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
                  デモ用の要約です。新しく保存した記事では本文の抜粋を表示します。
                </p>
              ) : null}
            </>
          ) : (
            <p>{stock.error ?? '要約を生成しています。少しお待ちください。'}</p>
          )}
          {stock.status === 'failed' && !youtube && (
            <>
              {stock.source_type === 'url' && (
                <>
                  <label htmlFor="retry-content">本文を補完して再試行（任意）</label>
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
                        ? 'テキストの要約の再試行を受け付けました。'
                        : '記事の再取得を受け付けました。',
                    );
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                {supplemental.trim()
                  ? 'この本文で再試行'
                  : stock.source_type === 'text'
                    ? '要約を再試行'
                    : '取得を再試行'}
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
            本文を読み込んでいます…
          </p>
        ) : (
          <pre className="article-body">
            {content ?? '取得した本文はありません。サンプル記事では元の記事をご覧ください。'}
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
                  ? 'メモを保存しました。問い・気づきとメモリに反映します。'
                  : 'メモと保存先を更新しました。',
              );
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <label htmlFor="edit-note">
            {stock.summary?.shortSource ? 'なぜ気になった？（メモ）' : 'メモ'}
          </label>
          {stock.summary?.shortSource && (
            <p id={noteHintId} className="local-model-note">
              気になった理由を一言残すと、問い・気づきとメモリに反映されます。原文はそのまま残ります。
              プロジェクトの公開時は、メモをもとに作った問い・気づきも公開されます。
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
          <label htmlFor="edit-project">保存先プロジェクト</label>
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
              {busy && <Spinner />}変更を保存
            </button>
          </div>
        </form>
      ) : null}
      <div hidden={tab !== 'comments'}>
        <Comments targetType="stock" targetId={stock.id} />
      </div>
      <FormError error={error} />
      <div className="detail-footer">
        <span>{fullDate(stock.created_at)} に保存</span>
      </div>
      <DeleteAction
        label="このストックを削除"
        title="このストックを削除しますか？"
        disabled={busy || favoriteBusy}
        onDelete={async () => {
          await api(`/api/v1/stocks/${stock.id}`, { method: 'DELETE' });
          onDone('記事を削除し、メモリの更新を受け付けました。');
        }}
      >
        <p className="delete-target">{displayTitle}</p>
        <p>保存先：{stock.project_name}</p>
        <p>
          このプロジェクトのストックと、紐づく問い・気づき・プ譜（すべての局面）・コメントを削除します。他のプロジェクトに保存した同じ記事は残ります。
        </p>
        <p>この操作は取り消せません。</p>
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
  const base = baseUrl;
  const [projectId, setProjectId] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const example = JSON.stringify(
    {
      url: '手順03で取得した記事URL（マジック変数）',
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
            <h2>共有メニューから、記事をストック。</h2>
            <p>記事を読んでいる途中でも、共有メニューから保存できます。</p>
          </div>
        </div>
        <ol className="setup-steps">
          <li>
            <span>01</span>
            <div>
              <h3>トークンを発行する</h3>
              <p>
                下の「トークンを発行」から作成します。保存先を特定のプロジェクトに限定することもできます。
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>共有シートからURLを受け取る</h3>
              <p>
                iPhoneの「ショートカット」アプリで「＋」から作成し、詳細で「共有シートに表示」をオンにします。受け取る種類は「URL」と「SafariのWebページ」を選びます。
              </p>
              <p>
                先頭に「共有シートから…を受け取る」と表示されます。名前は「Pufu
                Lens共有」などにします。
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>「入力からURLを取得」を追加する</h3>
              <p>
                アクションを追加して「URLを取得」を検索し、入力に「ショートカットの入力」を指定します。共有された記事からURLを取り出すためのアクションです。
              </p>
              <p>
                記事は1件ずつ共有します。複数のURLがある場合は「リストから項目を取得」で最初の項目を選びます。
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>「URLの内容を取得」でPOSTする</h3>
              <p>
                次に「URLの内容を取得」を追加し、URL欄には下の保存APIのURLを貼り付けます。詳細を開いて「方法」をPOST、「本文を要求」をJSONにし、下のヘッダと本文を設定します。
              </p>
              <p>
                JSONのurl欄は「テキスト」型を選び、値には手順03で取得した記事URLのマジック変数（複数時は先頭の1件を選んだ結果）を指定します。設定例の説明文をそのまま入力しないでください。Authorizationには「Bearer
                」に続けて発行したトークンを貼り付けます。
              </p>
              <p>
                トークンの送信先は下の保存APIです。共有された記事のURLを「URLの内容を取得」の送信先に設定しないでください。
              </p>
              <p>
                project_idは任意です。省略すると、プロジェクト限定トークンでは限定先に、限定なしトークンでは自分の全プロジェクトに保存します。限定先と異なるIDは指定できません。
              </p>
              <details>
                <summary>ショートカットの実行時に保存先を選ぶ場合</summary>
                <p>
                  同じAuthorizationヘッダを付けて次のURLをGETし、返されたprojectsから名前を選び、そのidをproject_idに指定します。
                </p>
                <code>{base}/api/v1/projects</code>
              </details>
            </div>
          </li>
        </ol>
        <figure className="shortcut-setup-figure">
          <figcaption>ショートカットの設定イメージ</figcaption>
          <img
            src={shortcutSetupImage}
            width={881}
            height={1785}
            loading="lazy"
            decoding="async"
            alt="共有シートでURL・SafariのWebページを受け取り、ショートカットの入力からURLを取得します。続く「URLの内容を取得」は方法POST、ヘッダはAuthorizationにBearerと発行したトークン、Content-Typeにapplication/json。本文を要求はJSON、urlには「URL」のマジック変数を指定する設定例です。"
          />
          <p>図の「保存APIのURL」には、次のURLを設定します。</p>
          <code>{base}/api/v1/stocks</code>
        </figure>
        <div className="api-example">
          <div>
            <span>POST</span>
            <code>{base}/api/v1/stocks</code>
            <button
              className="icon-button small"
              aria-label="保存APIのURLをコピー"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${base}/api/v1/stocks`);
                  setCopied(true);
                  setCopyError('');
                } catch {
                  setCopyError(
                    'コピーできませんでした。表示されたURLを選択してコピーしてください。',
                  );
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
          <pre id="shortcut-body-example">
            Authorization: Bearer &lt;発行したトークン&gt;{'\n'}Content-Type: application/json
            {'\n\n'}
            {example}
          </pre>
        </div>
        <FormError error={copyError} />
        <label htmlFor="shortcut-project">設定例の保存先（任意）</label>
        <select
          id="shortcut-project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">指定しない（トークンの設定に従う）</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <p className="guide-note">
          選ぶと、上のJSONに実際のプロジェクトIDを表示します。固定の保存先にする場合は、このIDもショートカットに設定してください。
        </p>
        <p className="guide-note">
          保存受付後はIDが返ります。要約とメモリの更新はアプリで確認できます。通信を再試行する場合は、同じIdempotency-Keyを付けてください。
        </p>
      </section>
      <section className="token-section">
        <div className="section-head">
          <div>
            <h2>連携トークン</h2>
            <p>トークンの権限はプロジェクト一覧の取得と記事の保存です。</p>
          </div>
          <button className="button primary" onClick={onCreate}>
            <Plus size={17} aria-hidden="true" />
            トークンを発行
          </button>
        </div>
        {!tokens.length ? (
          <div className="token-empty">
            <KeyRound size={25} aria-hidden="true" />
            <p>まだトークンは発行されていません。</p>
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
                        'すべてのプロジェクト'}{' '}
                      ·{' '}
                      {inactive
                        ? token.revoked_at
                          ? '失効済み'
                          : '期限切れ'
                        : token.expires_at === null
                          ? '無期限'
                          : `${date(token.expires_at)}まで有効`}
                    </span>
                    {token.last_used_at && <small>最終使用：{fullDate(token.last_used_at)}</small>}
                  </div>
                  <button
                    className="button secondary"
                    disabled={inactive}
                    onClick={() => {
                      if (
                        window.confirm(
                          'このトークンを失効しますか？設定済みのショートカットからは保存できなくなります。',
                        )
                      )
                        void onRevoke(token.id);
                    }}
                  >
                    失効する
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
          <h3>トークンを発行しました</h3>
        </div>
        <p>トークン全体が表示されるのは、この画面だけです。ショートカットに登録してください。</p>
        <label htmlFor="new-token-value">Bearerトークン</label>
        <textarea id="new-token-value" value={token} readOnly rows={3} />
        <button
          className="button primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token);
              setCopied(true);
              setError('');
            } catch {
              setError('コピーできませんでした。トークンを選択してコピーしてください。');
            }
          }}
        >
          {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
          {copied ? 'コピーしました' : 'トークンをコピー'}
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
          const result = await send<{ token: string }>('/api/v1/tokens', {
            name,
            project_id: project || null,
            expires_days: days,
          });
          setToken(result.token);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="form-intro">端末や用途ごとに発行すると、必要なトークンだけ失効できます。</p>
      <label htmlFor="token-name">トークン名</label>
      <input
        id="token-name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={80}
      />
      <label htmlFor="token-project">保存先の制限</label>
      <select id="token-project" value={project} onChange={(e) => setProject(e.target.value)}>
        <option value="">自分のすべてのプロジェクト</option>
        {projects.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <label htmlFor="token-days">有効期間</label>
      <select
        id="token-days"
        value={days ?? 'unlimited'}
        onChange={(e) => setDays(e.target.value === 'unlimited' ? null : Number(e.target.value))}
      >
        <option value={30}>30日</option>
        <option value={90}>90日</option>
        <option value={365}>365日</option>
        <option value="unlimited">無期限</option>
      </select>
      <FormError error={error} />
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          {busy ? <Spinner /> : <KeyRound size={17} aria-hidden="true" />}発行する
        </button>
      </div>
    </form>
  );
}
