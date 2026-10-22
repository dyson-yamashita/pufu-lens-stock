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
          <li>保存先のプロジェクトを選び、投稿URLか本文を入力して「ストックする」を押します。</li>
          <li>追加したカードを開くと、要約・要点・問いを確認できます。</li>
        </ol>
        <p>保存時にメモやテキストのタイトルを付ける場合は、「詳細」を開いて入力します。</p>
        <p>
          公開されたPDFのURLも保存できます。文字情報のあるPDFから本文を読み取り、要約や問いを生成します。画像だけのスキャンPDFやパスワード付きPDFは自動取得できません。取得に失敗した場合は、詳細画面で本文を補完して再試行できます。
        </p>
        <p>
          あとで読み返したい記事には星を付けられます。「メモ・保存先」では、メモや保存先を変更できます。
        </p>
        <p>
          プロジェクトの作成時または「設定」の「詳細設定」で「すべてのストックと問いの一覧に表示する」をオフにすると、全体の一覧と件数から外せます。初期値はオンです。オフでもプロジェクトを指定すれば表示でき、メモリや公開設定は変わりません。
        </p>
        <p>
          タイトルを変えるときは、詳細画面のタイトル右の鉛筆を押します。編集後に「保存」で確定し、「キャンセル」で取り消せます。公開中のプロジェクトでは、変更したタイトルが公開ページにも反映されます。
        </p>
        <p className="manual-note">
          Xの投稿は「外部連携」でX
          API連携の設定が必要です。YouTubeの一覧には静止画のサムネイルを表示します。画像かタイトルを押して詳細画面を開き、「動画」で再生できます。初期タイトルは「YouTube」で、タイトル右の鉛筆から変更できます。URLとメモだけを保存し、動画情報の取得や要約・問いの生成は行いません。チャンネルURLや再生できない動画は「YouTubeで開く」からご覧ください。
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
        <li>
          プ譜の画像を押すと、拡大表示できます。ピンチや＋・−で拡大縮小し、ドラッグで移動します。
        </li>
        <li>画像右下の「編集する」を押し、開いた画面で目標や施策を編集して「保存」で残します。</li>
        <li>「局面を追加」で次の段階へ進め、振り返りや進捗を記録できます。</li>
        <li>
          編集画面の横幅が狭い場合は、全体マップをタップ・ドラッグして表示位置を移動できます。
        </li>
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
        <p>
          YouTubeは、自分でメモを書いた場合だけ、そのメモをメモリに反映します。動画の内容・字幕・動画情報は使いません。メモの追加・編集・削除に合わせて更新し、URLの保存だけや動画の表示・再生では更新しません。
        </p>
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
          「ショートカット連携」でトークンを発行し、案内に表示される送信先URLと保存先を使って設定します。「共有シートから受け取る」→「入力からURLを取得」→「URLの内容を取得」の順に設定すると、開いている記事を共有メニューからストックできます。
        </li>
        <li>
          <strong>ChatGPTなどとの連携：</strong>
          「外部連携」の「MCP連携」にあるURLを接続先へ登録します。ログイン後に、許可する操作と対象プロジェクトを選びます。問いとプ譜の閲覧を許可すると、保存済みのプ譜を会話で確認し、改善案の検討にも使えます。
        </li>
        <li>
          <strong>MCPで関連するストックを探す：</strong>
          通常はキーワードで検索します。意味の近い内容も探す場合は、接続先にハイブリッド検索を指定して依頼できます。管理者の検索設定と索引の準備が必要です。準備中や利用上限・接続障害時はキーワード検索に戻るため、実際に使われた検索方式も確認してください。記事本文は検索対象に含みません。
        </li>
        <li>
          <strong>ChatGPTなどでプ譜を確認する：</strong>
          問いの詳細から紐づくプ譜の一覧を確認し、取得したいプ譜を指定してJSONや画像で確認できます。複数のプ譜がある場合も選べます。「プ譜を表示して」と依頼すると、対応環境では会話内のビューアーで拡大・移動・PNGの保存ができます。表示に失敗した場合は「再取得」を選びます。ビューアーが使えない環境では、画像や外部リンクの取得を依頼してください。画像はリクエスト時に、指定したプ譜の最新局面から生成します。リンクを知る人が1時間閲覧でき、期限切れやプ譜の更新・削除後は再取得してください。リンクを使えない場合は、PNGファイルへの保存を依頼できます。閲覧を許可した本人のプロジェクトが対象です。
        </li>
        <li>
          <strong>接続をやめる：</strong>
          「外部連携」の「接続中のサービス」から、対象の連携を解除できます。
        </li>
      </ul>
    ),
  },
  {
    id: 'withdrawal',
    title: '退会する',
    content: (
      <>
        <ol>
          <li>サイドメニューの「プロフィール」を開きます。</li>
          <li>「退会するには？」を押して退会欄を開きます。</li>
          <li>「退会する」を押し、削除されるデータを確認します。</li>
          <li>「すべて削除して退会する」で確定します。</li>
        </ol>
        <p className="manual-note">
          登録したデータと保存本文が削除され、復元できません。公開中のプロジェクトも閲覧できなくなり、すべての端末でログアウトし、連携も無効になります。削除が継続中の場合は画面に案内が表示されます。Googleアカウント自体は削除されません。
        </p>
      </>
    ),
  },
  {
    id: 'help',
    title: '困ったときは',
    content: (
      <dl className="manual-help">
        <dt>記事の取得に失敗した</dt>
        <dd>
          ストックの詳細を開き、「要約」の「取得を再試行」を使います。本文を貼り付けて再試行することもできます。PDFは10MB・100ページまでが対象です。ページの閲覧制限や、画面に表示された外部連携の設定も確認してください。YouTubeの動画は埋め込みプレーヤーで表示するため、記事取得の再試行はできません。再生できない場合は「YouTubeで開く」からご覧ください。
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
