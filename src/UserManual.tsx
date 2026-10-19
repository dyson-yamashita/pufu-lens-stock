import { useEffect } from 'react';
import { ArrowUp, BookOpen } from 'lucide-react';
import LegalLinks from './LegalLinks';

const sections = [
  {
    id: 'stocks',
    title: '記事をストックする',
    content: (
      <>
        <ol>
          <li>「記事をストック」を開き、「URL」か「テキスト」を選びます。</li>
          <li>内容と保存先のプロジェクトを指定し、「ストックする」を押します。</li>
          <li>追加したカードを開くと、要約・要点・問いを確認できます。</li>
        </ol>
        <p>
          あとで読み返したい記事には星を付けられます。「メモ・保存先」では、メモや保存先を変更できます。
        </p>
        <p className="manual-note">
          Xの投稿は「外部連携」でX
          API連携の設定が必要です。YouTubeのコンテンツは記録できません。YouTubeのURLを追加すると、URLと記録できない旨の案内だけをストックに残し、要約や問いは生成しません。
        </p>
      </>
    ),
  },
  {
    id: 'questions',
    title: '問いを見つける・書く',
    content: (
      <>
        <p>
          「問い」タブや「すべての問い」から、ストックをもとにAIが作った問いを見られます。気になる問いを開いて、次に考えたいことを探してみましょう。
        </p>
        <p>
          「問いを追加」から、自分の問いも保存できます。関連する記事を選ばず、プロジェクトに直接問いを追加することもできます。
        </p>
      </>
    ),
  },
  {
    id: 'pufu',
    title: 'プ譜で解決の案をつくる',
    content: (
      <ol>
        <li>問いの詳細で「問いの解決を考える」を選びます。</li>
        <li>実現したい状態を課題として書き、「プ譜を作成」を押します。</li>
        <li>生成された目標や施策を編集し、「保存」で残します。</li>
        <li>「局面を追加」で次の段階へ進め、振り返りや進捗を記録できます。</li>
      </ol>
    ),
  },
  {
    id: 'memory',
    title: 'メモリで関心と知識を振り返る',
    content: (
      <>
        <p>
          記事の要約が増えると、関心の傾向や記事から得た知識がメモリにまとまります。プロジェクトの「メモリ」はそのプロジェクト、「あなたのメモリ」は対象のプロジェクトを横断した内容です。
        </p>
        <p>知識に付いた「ストックした記事」から、もとになった記事を確認できます。</p>
        <p className="manual-note">
          ユーザーメモリに含めたくないプロジェクトは、作成時または「設定」の「詳細設定」で「ストック追加時にユーザーのメモリを更新する」をオフにします。初期値はオンです。オフでもプロジェクトのメモリは更新されますが、後日のユーザーメモリ更新でも、そのプロジェクトの記事は対象から外れます。
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    title: 'プロジェクトを公開する',
    content: (
      <>
        <ol>
          <li>公開したいプロジェクトの「設定」を開きます。</li>
          <li>「公開設定」で公開をオンにし、公開用の紹介文を入力して保存します。</li>
          <li>表示された参照用URLを共有します。トップページの公開プロジェクトにも掲載されます。</li>
        </ol>
        <p>
          公開ページはログインなしで閲覧でき、編集はできません。ストックのタイトル・URL・要約・要点・トピック、問い、紐づくプ譜の最新局面・振り返りが公開されます。
        </p>
        <p className="manual-note">
          メモリ・個人メモ・取得した本文・内部用のプロジェクト概要は公開しません。プ譜に書いた内容も公開されるため、公開前に確認してください。公開をオフにして保存すると、参照用URLからも閲覧できなくなります。
        </p>
      </>
    ),
  },
  {
    id: 'integrations',
    title: 'ほかのアプリから使う',
    content: (
      <ul>
        <li>
          <strong>iPhoneの共有メニュー：</strong>
          「ショートカット連携」の案内に沿って設定すると、開いている記事を共有メニューからストックできます。
        </li>
        <li>
          <strong>ChatGPTなどとの連携：</strong>
          「外部連携」の「MCP連携」にあるURLを接続先へ登録します。ログイン後に、許可する操作と対象プロジェクトを選びます。
        </li>
        <li>
          <strong>接続をやめる：</strong>
          「外部連携」の「接続中のサービス」から、対象の連携を解除できます。
        </li>
      </ul>
    ),
  },
  {
    id: 'help',
    title: '困ったときは',
    content: (
      <dl className="manual-help">
        <dt>記事の取得に失敗した</dt>
        <dd>
          ストックの詳細を開き、「要約」の「取得を再試行」を使います。ページの閲覧制限や、画面に表示された外部連携の設定も確認してください。YouTubeのURLは記録対象外のため、再試行できません。
        </dd>
        <dt>要約やプ譜がまだ表示されない</dt>
        <dd>
          保存後の処理には時間がかかることがあります。処理中の表示を確認し、少し待ってください。失敗が表示された場合は、画面の案内から再試行できます。
        </dd>
      </dl>
    ),
  },
];

export default function UserManual() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'ユーザーマニュアル | Pufu Lens';
    // Reactの描画後にも、直リンクで指定された節を表示する。
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    return () => {
      document.title = previousTitle;
    };
  }, []);
  return (
    <div className="public-page manual-page">
      <header className="public-header">
        <a href="/" className="brand">
          <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
          <span>Pufu Lens</span>
        </a>
        <a href="/" className="text-link">
          トップへ戻る
        </a>
      </header>
      <main className="manual-main">
        <header className="page-header" id="manual-start" tabIndex={-1}>
          <div>
            <h1>ユーザーマニュアル</h1>
            <p>記事を集め、問いを育て、次のアイデアにつなげるための基本ガイドです。</p>
          </div>
        </header>
        <section className="manual-start" aria-labelledby="manual-start-heading">
          <h2 id="manual-start-heading">
            <BookOpen size={20} aria-hidden="true" />
            まずは、ここから
          </h2>
          <ol>
            <li>
              <a href="/terms">利用規約</a>と<a href="/privacy">プライバシーポリシー</a>
              を確認して同意のうえ、Googleでログインし、サイドメニューからプロジェクトを追加します。
            </li>
            <li>気になった記事のURLや、自分のテキストをストックします。</li>
            <li>問いを選び、プ譜で解決の案を考えてみましょう。</li>
          </ol>
        </section>
        <nav className="manual-toc" aria-label="マニュアルの目次">
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>
        {sections.map((section) => (
          <section
            className="manual-section"
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            tabIndex={-1}
          >
            <h2 id={`${section.id}-heading`}>{section.title}</h2>
            {section.content}
          </section>
        ))}
        <a className="text-link manual-back-top" href="#manual-start">
          <ArrowUp size={16} aria-hidden="true" />
          ページの先頭へ
        </a>
        <LegalLinks />
      </main>
    </div>
  );
}
