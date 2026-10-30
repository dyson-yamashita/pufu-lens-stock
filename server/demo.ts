import type { Env } from './env';
import type { ArticleSummary } from '../shared/domain';

export async function seedDemo(env: Env) {
  const proposedId = `local-demo-${crypto.randomUUID()}`;
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, google_sub, name) VALUES (?, 'local-demo', '')",
  )
    .bind(proposedId)
    .run();
  const user = await env.DB.prepare("SELECT id FROM users WHERE google_sub = 'local-demo'").first<{
    id: string;
  }>();
  const userId = user!.id;
  if (!inserted.meta.changes) return { created: false, userId, projectIds: [] };
  // 再登録時はR2プレフィックスとWorkflow対象のIDも新しくし、旧削除処理と分離する。
  const projectIds = [`demo-cloudflare-${userId}`, `demo-product-${userId}`];
  const samples: {
    id: string;
    project: string;
    title: string;
    url: string;
    days: number;
    summary: ArticleSummary;
    note: string;
  }[] = [
    {
      id: 'demo-article-workflows',
      project: 'demo-cloudflare',
      title: 'Cloudflare Workflowsで、非同期処理をもっと確実に',
      url: 'https://developers.cloudflare.com/workflows/',
      days: 0,
      note: '記事取得と要約を別の工程にしたい。',
      summary: {
        overview:
          'Workflowsは複数の処理工程をつなぎ、進行状況を保持する仕組み。失敗した工程を再試行できるため、記事取得やAI要約のような外部サービスを使う処理に向いている。',
        keyPoints: [
          '工程ごとに状態を保持し、失敗した処理を再試行する。',
          '再試行に備え、データ保存の処理には冪等性が必要。',
        ],
        topics: ['Cloudflare', '非同期処理', '信頼性'],
      },
    },
    {
      id: 'demo-article-d1',
      project: 'demo-cloudflare',
      title: 'D1で始める、サーバーレスなデータ管理',
      url: 'https://developers.cloudflare.com/d1/',
      days: 1,
      note: '',
      summary: {
        overview:
          'D1はCloudflareのサーバーレスSQLデータベース。Workersからバインディングを通じて利用でき、ユーザーやプロジェクト、保存記事のような関係のあるデータを管理できる。',
        keyPoints: [
          'SQLを使ってデータ同士の関係を表現できる。',
          '検索条件に合ったインデックスが読み取りの効率を左右する。',
        ],
        topics: ['Cloudflare', 'データベース', 'D1'],
      },
    },
    {
      id: 'demo-article-shortcuts',
      project: 'demo-product',
      title: 'いつもの共有メニューを、知識の入口に',
      url: 'https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios',
      days: 2,
      note: '保存の操作を短くしたい。',
      summary: {
        overview:
          'iOSショートカットの「URLの内容を取得」では、HTTP APIへリクエストを送れる。POSTの本文にJSONを指定できるため、共有したURLを保存サービスへ渡す入口として利用できる。',
        keyPoints: [
          'POST、PUT、PATCHではJSONなどのリクエスト本文を送信できる。',
          '共有メニューから受け取ったURLをAPIへ渡す操作を組み合わせられる。',
        ],
        topics: ['iOS', 'ショートカット', 'ユーザー体験'],
      },
    },
    {
      id: 'demo-article-identity',
      project: 'demo-cloudflare',
      title: 'Googleログインと、アプリのセッションを理解する',
      url: 'https://developers.google.com/identity/openid-connect/openid-connect',
      days: 3,
      note: '',
      summary: {
        overview:
          'GoogleのOpenID ConnectではIDトークンを検証してユーザーを識別する。ユーザーとの対応には、変更される可能性があるメールアドレスよりも、アカウントの識別子subが適している。',
        keyPoints: [
          'IDトークンの署名、有効期限、発行者、対象アプリを検証する。',
          'ユーザーの識別にはsubを利用する。',
        ],
        topics: ['認証', 'Google', 'セキュリティ'],
      },
    },
  ];
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO projects (id, user_id, name, description) VALUES (?, ?, 'Cloudflareでつくる', 'Cloudflareで小さく始め、確実に動くアプリを設計する。')",
    ).bind(projectIds[0], userId),
    env.DB.prepare(
      "INSERT INTO projects (id, user_id, name, description) VALUES (?, ?, '日々のインプット', '読みたい記事を無理なく集め、知識をつなげる体験を考える。')",
    ).bind(projectIds[1], userId),
    ...samples.flatMap((sample) => [
      env.DB.prepare(
        "INSERT INTO articles (id, user_id, canonical_url, source_url, title, domain, status, summary_json, model, created_at) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, 'demo-fixture', ?)",
      ).bind(
        `${sample.id}-${userId}`,
        userId,
        sample.url,
        sample.url,
        sample.title,
        new URL(sample.url).hostname,
        JSON.stringify(sample.summary),
        new Date(Date.now() - sample.days * 86400000).toISOString(),
      ),
      env.DB.prepare(
        'INSERT INTO stocks (id, user_id, project_id, article_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(
        `stock-${sample.id}-${userId}`,
        userId,
        `${sample.project}-${userId}`,
        `${sample.id}-${userId}`,
        sample.note,
        new Date(Date.now() - sample.days * 86400000).toISOString(),
      ),
    ]),
  ]);
  return { created: true, userId, projectIds };
}
