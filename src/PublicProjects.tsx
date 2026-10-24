import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleHelp,
  Copy,
  ExternalLink,
  Folder,
  Globe,
  Layers,
  LoaderCircle,
  LockKeyhole,
} from 'lucide-react';
import type {
  Publication,
  PublicList,
  PublicProject,
  PublicStock,
  PublicStockDetail,
  PublicQuestion,
  PublicPufu,
  PublicPufuSummary,
} from '../shared/public-project';
import { api, send } from './api';
import QuestionLabels from './QuestionLabels';
import YouTubePlayer from './YouTubePlayer';
import YouTubeThumbnail from './YouTubeThumbnail';
import { isYouTubeUrl, youtubeDisplayTitle } from '../shared/youtube';

const PublicPufuScore = lazy(async () => {
  try {
    return await import('./PublicPufuScore');
  } catch {
    return {
      default: () => (
        <ResourceState
          error="プ譜エディターを読み込めませんでした。再読み込みしてください。"
          retry={() => window.location.reload()}
        />
      ),
    };
  }
});

function useResource<T>(path: string) {
  const [state, setState] = useState<{ path: string; data?: T; error?: string }>({ path });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ path });
    api<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({ path, data });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setState({ path, error: e.message });
      });
    return () => controller.abort();
  }, [path, retry]);
  return { ...(state.path === path ? state : { path }), reload: () => setRetry((v) => v + 1) };
}
function ResourceState({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div role="alert" className="public-message">
      <p>{error}</p>
      <button className="button secondary" onClick={retry}>
        再読み込み
      </button>
    </div>
  ) : (
    <p role="status" className="public-message">
      <LoaderCircle className="spin" size={18} aria-hidden="true" />
      読み込んでいます…
    </p>
  );
}
function PublicBrand() {
  return (
    <a href="/" className="brand">
      <img src="/pufu-lens-logo.png" alt="" width="38" height="38" />
      <span>Pufu Lens</span>
    </a>
  );
}
function Pagination({
  page,
  hasMore,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  onChange: (page: number) => void;
}) {
  if (page === 1 && !hasMore) return null;
  return (
    <nav className="public-pagination" aria-label="ページ切り替え">
      <button className="button secondary" disabled={page === 1} onClick={() => onChange(page - 1)}>
        前へ
      </button>
      <span>{page}ページ</span>
      <button className="button secondary" disabled={!hasMore} onClick={() => onChange(page + 1)}>
        次へ
      </button>
    </nav>
  );
}
export function PublicProjectDirectory() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useResource<PublicList<PublicProject>>(
    `/api/public/projects?page=${page}`,
  );
  return (
    <section className="public-directory" aria-labelledby="public-directory-heading">
      <div className="public-section-heading">
        <h2 id="public-directory-heading">公開プロジェクト</h2>
      </div>
      <p className="public-lead">
        誰かの関心から、次のアイデアへ。ストックと問い・気づき、その先のプ譜をのぞいてみませんか。
      </p>
      {!data ? (
        <ResourceState error={error} retry={reload} />
      ) : (
        <>
          <div className="public-project-grid">
            {data.items.map((project) => (
              <a
                className="public-project-card"
                key={project.public_id}
                href={`/p/${encodeURIComponent(project.public_id)}`}
              >
                <span className="public-badge">
                  <Globe size={13} aria-hidden="true" />
                  公開
                </span>
                <h3 title={project.name}>{project.name}</h3>
                <p>
                  {project.public_description ||
                    '集めたストックと、そこから生まれた問い・気づきを公開しています。'}
                </p>
                <div className="public-card-footer">
                  <span>
                    <Layers size={16} aria-hidden="true" />
                    {project.stock_count} ストック
                  </span>
                  <span>
                    <CircleHelp size={16} aria-hidden="true" />
                    {project.question_count} 問い・気づき
                  </span>
                  <ArrowRight size={18} aria-hidden="true" />
                </div>
              </a>
            ))}
          </div>
          {data.items.length === 0 && (
            <p className="public-message">公開プロジェクトはまだありません。</p>
          )}
          <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
        </>
      )}
    </section>
  );
}
export function ProjectPublicationSettings({ projectId }: { projectId: string }) {
  const id = useId();
  const { data, error, reload } = useResource<{ publication: Publication }>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/publication`,
  );
  return (
    <section className="publication-settings" aria-labelledby={`${id}-title`}>
      <div className="public-section-heading">
        <h2 id={`${id}-title`}>
          <Globe size={20} aria-hidden="true" />
          公開設定
        </h2>
      </div>
      {data ? (
        <PublicationForm
          key={`${projectId}-${data.publication.public_id}`}
          initial={data.publication}
          projectId={projectId}
        />
      ) : (
        <ResourceState error={error} retry={reload} />
      )}
    </section>
  );
}
function PublicationForm({ initial, projectId }: { initial: Publication; projectId: string }) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.is_public);
  const [description, setDescription] = useState(initial.public_description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const url = saved.public_id ? `${window.location.origin}/p/${saved.public_id}` : '';
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        setMessage('');
        try {
          const result = await send<{ publication: Publication }>(
            `/api/v1/projects/${encodeURIComponent(projectId)}/publication`,
            { is_public: enabled, public_description: description },
            'PATCH',
          );
          setSaved(result.publication);
          setDescription(result.publication.public_description);
          setMessage(
            result.publication.is_public
              ? '公開設定を保存しました。トップページにも掲載されています。'
              : '非公開にしました。公開URLからも閲覧できません。',
          );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="project-memory-toggle" htmlFor={`${id}-toggle`}>
        <span>プロジェクトを公開する</span>
        <input
          id={`${id}-toggle`}
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={busy}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setMessage('');
          }}
          aria-describedby={`${id}-scope`}
        />
      </label>
      <p className="public-help" id={`${id}-scope`}>
        公開すると、ログインなしで閲覧できるURLが発行され、トップページの公開プロジェクト一覧に掲載されます。
      </p>
      <div className="publication-scope">
        <strong>公開する内容</strong>
        <ul>
          <li>プロジェクト名と公開用の紹介文</li>
          <li>ストックのタイトル・URL・要約・要点・トピック</li>
          <li>問い・気づきと、紐づくプ譜の最新局面・振り返り</li>
        </ul>
        <p>
          <LockKeyhole size={15} aria-hidden="true" />
          メモリ、個人メモ、取得した本文、内部用のプロジェクト概要は公開しません。
        </p>
      </div>
      <p className="public-help">
        公開中に追加・変更した内容も反映されます。プ譜に書かれた内容も公開されるため、公開前に各内容を確認してください。
      </p>
      <label htmlFor={`${id}-description`}>
        公開用の紹介文 <span className="optional">任意</span>
      </label>
      <textarea
        id={`${id}-description`}
        rows={3}
        maxLength={1000}
        value={description}
        disabled={busy}
        placeholder="このプロジェクトで集めているテーマや、公開する目的など"
        onChange={(e) => setDescription(e.target.value)}
      />
      {saved.is_public && url && (
        <div className="publication-url">
          <label htmlFor={`${id}-url`}>公開URL</label>
          <input id={`${id}-url`} readOnly value={url} />
          <div>
            <a className="button secondary" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} aria-hidden="true" />
              公開ページを確認
            </a>
            <button
              className="button subtle"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setMessage('公開URLをコピーしました。');
                } catch {
                  setError('URLを選択してコピーしてください。');
                }
              }}
            >
              <Copy size={16} aria-hidden="true" />
              コピー
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="publication-success">
          <Check size={16} aria-hidden="true" />
          {message}
        </p>
      )}
      <div className="form-actions">
        <span className="public-help">現在：{saved.is_public ? '公開中' : '非公開'}</span>
        <button className="button primary" disabled={busy}>
          {busy ? '保存中…' : '公開設定を保存'}
        </button>
      </div>
    </form>
  );
}
function StockTopics({ stock }: { stock: PublicStock }) {
  return (
    stock.summary && (
      <div className="public-topics">
        {stock.summary.topics.map((topic, i) => (
          <span key={i}>{topic}</span>
        ))}
      </div>
    )
  );
}
function StockCard({ stock }: { stock: PublicStock }) {
  const youtube = Boolean(stock.source_url && isYouTubeUrl(stock.source_url));
  return (
    <a
      className="public-content-card public-stock-card"
      href={`#stock/${encodeURIComponent(stock.id)}`}
    >
      <p className="public-meta">
        <BookOpen size={16} aria-hidden="true" />
        {stock.domain || 'テキスト'}
        <time>{new Date(stock.created_at).toLocaleDateString('ja-JP')}</time>
      </p>
      <h3>{youtube ? youtubeDisplayTitle(stock.title) : stock.title}</h3>
      {youtube && <YouTubeThumbnail url={stock.source_url!} />}
      <p className="public-summary">
        {youtube
          ? 'YouTubeのリンクを保存しています。'
          : stock.summary?.overview || '要約はまだありません。'}
      </p>
      <StockTopics stock={stock} />
      <div className="public-card-footer">
        <span>ストックの詳細を見る</span>
        <ArrowRight size={18} aria-hidden="true" />
      </div>
    </a>
  );
}
function StockDetails({
  stock,
  heading: Heading = 'h3',
}: {
  stock: PublicStock;
  heading?: 'h3' | 'h4';
}) {
  const href = stock.source_url && /^https?:\/\//i.test(stock.source_url) ? stock.source_url : null;
  const youtube = Boolean(href && isYouTubeUrl(href));
  const PointsHeading = Heading === 'h4' ? 'h5' : 'h4';
  return (
    <article className="public-content-card public-stock-detail">
      <p className="public-meta">
        <BookOpen size={16} aria-hidden="true" />
        {stock.domain || 'テキスト'}
        <time>{new Date(stock.created_at).toLocaleDateString('ja-JP')}</time>
      </p>
      <Heading className="public-stock-title">
        {youtube ? youtubeDisplayTitle(stock.title) : stock.title}
      </Heading>
      {youtube ? (
        <YouTubePlayer url={href!} />
      ) : (
        <p className="public-summary">{stock.summary?.overview || '要約はまだありません。'}</p>
      )}
      {!youtube && stock.summary && (
        <section className="public-stock-points" aria-label="要点">
          <PointsHeading>要点</PointsHeading>
          <ul>
            {stock.summary.keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </section>
      )}
      <StockTopics stock={stock} />
      {href && (
        <a className="text-link" href={href} target="_blank" rel="noreferrer">
          {youtube ? 'YouTubeで開く' : '元の記事を開く'}{' '}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
    </article>
  );
}
function PublicQuestionCard({ question }: { question: PublicQuestion }) {
  return (
    <a
      className="public-content-card public-question-card"
      href={`#question/${encodeURIComponent(question.id)}`}
    >
      <QuestionLabels
        question={{ source: question.source, has_pufu: question.pufu_count > 0 ? 1 : 0 }}
      />
      <h3>{question.text}</h3>
      {question.article_title && <p className="public-help">{question.article_title}</p>}
      <div className="public-card-footer">
        <span>
          {question.pufu_count ? `${question.pufu_count}件のプ譜` : '問い・気づきの詳細を見る'}
        </span>
        <ArrowRight size={18} aria-hidden="true" />
      </div>
    </a>
  );
}
function PublicStockDetailPage({ root, id }: { root: string; id: string }) {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useResource<PublicStockDetail>(
    `${root}/stocks/${encodeURIComponent(id)}?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section aria-label="ストックの詳細">
      <a className="text-link" href="#stocks">
        <ArrowLeft size={16} aria-hidden="true" />
        ストックの一覧へ
      </a>
      <h2 className="public-detail-title">ストックの詳細</h2>
      <StockDetails stock={data.stock} />
      <h3 className="public-detail-title">関連する問い・気づき</h3>
      <div className="public-content-grid">
        {data.questions.map((question) => (
          <PublicQuestionCard key={question.id} question={question} />
        ))}
      </div>
      {!data.questions.length && (
        <p className="public-message">このストックには公開できる問い・気づきがまだありません。</p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
    </section>
  );
}
type PublicListProps = { root: string; page: number; onPageChange: (page: number) => void };
function PublicStockList({ root, page, onPageChange }: PublicListProps) {
  const { data, error, reload } = useResource<PublicList<PublicStock>>(
    `${root}/stocks?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <div className="public-content-grid">
        {data.items.map((stock) => (
          <StockCard key={stock.id} stock={stock} />
        ))}
      </div>
      {!data.items.length && <p className="public-message">ストックはまだありません。</p>}
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
function PublicQuestionList({ root, page, onPageChange }: PublicListProps) {
  const { data, error, reload } = useResource<PublicList<PublicQuestion>>(
    `${root}/questions?page=${page}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <>
      <div className="public-content-grid">
        {data.items.map((question) => (
          <PublicQuestionCard key={question.id} question={question} />
        ))}
      </div>
      {!data.items.length && (
        <p className="public-message">公開できる問い・気づきはまだありません。</p>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={onPageChange} />
    </>
  );
}
function PublicQuestionDetail({
  root,
  id,
  projectName,
}: {
  root: string;
  id: string;
  projectName: string;
}) {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useResource<{
    question: PublicQuestion;
    stock: PublicStock | null;
    pufus: PublicPufuSummary[];
    has_more: boolean;
  }>(`${root}/questions/${encodeURIComponent(id)}?page=${page}`);
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section
      className="question-detail-page public-question-detail"
      aria-label="問い・気づきの詳細"
    >
      <a className="back-link" href="#questions">
        <ArrowLeft size={16} aria-hidden="true" />
        問い・気づきの一覧に戻る
      </a>
      <header className="page-header">
        <div>
          <h2 className="page-title">問い・気づきの詳細</h2>
          <p>問い・気づきを見つめ直し、次の一歩へ。</p>
        </div>
      </header>
      <article className="question-detail-card">
        <div className="question-detail-meta">
          <QuestionLabels
            question={{
              source: data.question.source,
              has_pufu: data.question.pufu_count > 0 ? 1 : 0,
            }}
          />
          <span>
            <Folder size={15} aria-hidden="true" />
            {projectName}
          </span>
        </div>
        <h3 className="question-text">{data.question.text}</h3>
        {data.stock && (
          <div className="question-detail-source">
            <a href={`#stock/${encodeURIComponent(data.stock.id)}`}>
              <BookOpen size={17} aria-hidden="true" />
              <span>{data.stock.title}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        )}
        <div className="question-card-footer">
          <time dateTime={data.question.created_at}>
            {new Intl.DateTimeFormat('ja-JP', {
              dateStyle: 'medium',
              timeZone: 'Asia/Tokyo',
            }).format(new Date(data.question.created_at))}
          </time>
        </div>
      </article>
      <div className="section-head pufu-list-heading">
        <div>
          <h3 className="section-title">この問い・気づきのプ譜</h3>
          <p>課題ごとにまとめられた案を閲覧できます。</p>
        </div>
        <span className="result-count">{data.question.pufu_count}件</span>
      </div>
      {data.pufus.length ? (
        <div className="pufu-list">
          {data.pufus.map((pufu) => (
            <a
              className="pufu-list-item"
              key={pufu.id}
              href={`#pufu/${encodeURIComponent(pufu.id)}`}
            >
              <span>
                <strong>{pufu.task}</strong>
                <small>局面 {pufu.current_phase} · 閲覧のみ</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : (
        <div className="pufu-empty">
          <p>この問い・気づきのプ譜はまだありません。</p>
        </div>
      )}
      <Pagination page={page} hasMore={data.has_more} onChange={setPage} />
      {data.stock && (
        <>
          <h3 className="public-detail-title">ストックした記事</h3>
          <StockDetails stock={data.stock} heading="h4" />
          <a
            className="text-link public-detail-link"
            href={`#stock/${encodeURIComponent(data.stock.id)}`}
          >
            ストックの詳細を見る <ArrowRight size={16} aria-hidden="true" />
          </a>
        </>
      )}
    </section>
  );
}
function PublicPufuDetail({ root, id }: { root: string; id: string }) {
  const { data, error, reload } = useResource<{ pufu: PublicPufu }>(
    `${root}/pufus/${encodeURIComponent(id)}`,
  );
  return !data ? (
    <ResourceState error={error} retry={reload} />
  ) : (
    <section>
      <a className="text-link" href={`#question/${encodeURIComponent(data.pufu.question_id)}`}>
        <ArrowLeft size={16} aria-hidden="true" />
        問い・気づきに戻る
      </a>
      <h2 className="public-detail-title">{data.pufu.task}</h2>
      <p className="public-help">{data.pufu.question_text}</p>
      <p className="public-badge">
        最新の局面 {data.pufu.current_phase} ·{' '}
        {data.pufu.current_phase % 2 === 0 ? '振り返り' : 'プ譜'} · 閲覧のみ
      </p>
      <Suspense fallback={<ResourceState retry={reload} />}>
        <PublicPufuScore key={`${id}-${data.pufu.current_phase}`} score={data.pufu.score} />
      </Suspense>
    </section>
  );
}
export default function PublicProjectPage({ publicId }: { publicId: string }) {
  const root = `/api/public/projects/${encodeURIComponent(publicId)}`;
  const { data, error, reload } = useResource<{ project: PublicProject }>(root);
  const [hash, setHash] = useState(window.location.hash);
  const [stockPage, setStockPage] = useState(1);
  const [questionPage, setQuestionPage] = useState(1);
  useEffect(() => {
    const listener = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  const match = /^#(stock|question|pufu)\/([^/]+)$/.exec(hash);
  let content: ReactNode;
  if (match)
    content =
      match[1] === 'stock' ? (
        <PublicStockDetailPage key={match[2]} root={root} id={match[2]} />
      ) : match[1] === 'pufu' ? (
        <PublicPufuDetail root={root} id={match[2]} />
      ) : (
        <PublicQuestionDetail
          key={match[2]}
          root={root}
          id={match[2]}
          projectName={data?.project.name ?? ''}
        />
      );
  else
    content =
      hash === '#questions' ? (
        <PublicQuestionList root={root} page={questionPage} onPageChange={setQuestionPage} />
      ) : (
        <PublicStockList root={root} page={stockPage} onPageChange={setStockPage} />
      );
  return (
    <div className="public-page">
      <header className="public-header">
        <PublicBrand />
        <a className="text-link" href="/">
          トップへ
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </header>
      <main className="public-main">
        {!data ? (
          <ResourceState error={error} retry={reload} />
        ) : (
          <>
            <span className="public-badge">
              <Globe size={14} aria-hidden="true" />
              公開
            </span>
            <h1>{data.project.name}</h1>
            {data.project.public_description && (
              <p className="public-lead">{data.project.public_description}</p>
            )}
            <nav className="public-tabs" aria-label="公開プロジェクト">
              <a
                href="#stocks"
                aria-current={
                  match?.[1] === 'stock' || (!match && hash !== '#questions') ? 'page' : undefined
                }
              >
                <Layers size={18} aria-hidden="true" />
                ストック<span>{data.project.stock_count}</span>
              </a>
              <a
                href="#questions"
                aria-current={
                  hash === '#questions' || match?.[1] === 'question' ? 'page' : undefined
                }
              >
                <CircleHelp size={18} aria-hidden="true" />
                問い・気づき<span>{data.project.question_count}</span>
              </a>
            </nav>
            {content}
          </>
        )}
      </main>
      <footer className="public-footer">Pufu Lens · 集めた知識を、つながる記憶に。</footer>
    </div>
  );
}
