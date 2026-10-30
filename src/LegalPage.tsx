import { legalEn } from './locales/legal-en';
import { useLanguage, legalHref, translateUi } from './i18n';
import { languages, type Language } from '../shared/locale';
import { useEffect, type ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import LegalLinks from './LegalLinks';
import { legalVersions } from '../shared/legal';

type Section = { id: string; title: string; content: ReactNode };

function Contact() {
  return (
    <p>
      運営者：Pufu Lens 運営者
      <br />
      お問い合わせ先：Googleログインの同意画面に表示されるユーザーサポートのメールアドレス。
      データの開示・訂正・削除、利用停止のご希望やサービスについてのご質問は、この窓口へご連絡ください。
    </p>
  );
}

const privacySections: Section[] = [
  {
    id: 'scope',
    title: '1. このポリシーについて',
    content: (
      <p>
        Pufu Lens
        運営者（以下「運営者」）は、記事やテキストを集め、AIで要約・問い・気づき・メモリ・プ譜を作成するサービス「Pufu
        Lens」（以下「本サービス」）において、利用者の情報を以下のとおり取り扱います。
      </p>
    ),
  },
  {
    id: 'collected-data',
    title: '2. 取得・保存する情報',
    content: (
      <ul>
        <li>
          <strong>Googleログイン情報：</strong>
          本人を識別するため、Googleアカウントの識別子のみを取得・保存します。
          Googleのメールアドレス・名前・プロフィール画像は要求せず、保存・利用しません。GmailやGoogleドライブの内容を取得しません。
          Googleのパスワード、アクセストークン、リフレッシュトークンは保存しません。
        </li>
        <li>
          <strong>利用者が登録する情報：</strong>
          利用者が入力したニックネーム（表示名）・自己紹介・表示言語、プロジェクト名・概要・公開設定・紹介文、保存したURL・テキスト・メモ・コメント・お気に入り、問い・気づき、課題、プ譜、振り返りなどを保存します。利用開始時に同意した利用規約・プライバシーポリシーの版と同意日時を記録します。
        </li>
        <li>
          <strong>記事の取得情報と生成結果：</strong>
          保存したURLから取得した本文・タイトルなどと、AIが作成する要約・要点・トピック・問い・気づき・メモリ・プ譜を保存します。
          YouTubeのURLと利用者が記入したメモを保存します。動画はブラウザ上のYouTube埋め込みプレーヤーで表示し、本サービスのサーバーでは動画情報・動画本体・字幕を取得・保存しません。
        </li>
        <li>
          <strong>外部連携・利用状況：</strong>
          登録したXの認証トークン、APIトークンの照合情報、許可したMCP接続の権限・対象プロジェクト・利用日時、ログインセッション、保存・AI処理の利用件数や処理状況を保存します。
          登録されたXの認証トークンは暗号化して保存します。
        </li>
      </ul>
    ),
  },
  {
    id: 'google-user-data',
    title: '3. Googleユーザーデータの取り扱い',
    content: (
      <>
        <p>
          Pufu
          Lensは、利用者がGoogleの同意画面で許可した場合に、Googleログインを通じて情報を取得します。
          要求する権限は<code>openid</code>
          のみです。Gmail、Googleドライブ、GoogleカレンダーなどのGoogle
          Workspaceのデータにアクセスする権限は要求しません。
        </p>
        <ul>
          <li>
            <strong>取得する情報と用途：</strong>
            Googleアカウントの識別子（sub）をアカウントの識別と保存データの紐付けに使います。
            Googleのメールアドレス・名前・プロフィール画像は要求せず、以前の許可などで認証応答に含まれた場合も保存・利用しません。
            Googleのパスワードは取得しません。
          </li>
          <li>
            <strong>保存と保護：</strong>
            Googleアカウントの識別子をCloudflare
            D1データベースに保存し、利用者ごとのアクセス制御とHTTPS通信で保護します。
            Googleが発行する認証用トークンはログイン処理で一時的に扱い、継続アクセス用には保存しません。
          </li>
          <li>
            <strong>AI処理への送信：</strong>
            Googleから取得した識別子はAI生成の入力に使用しません。
            ユーザーメモリ生成には利用者自身が入力した自己紹介をCloudflare Workers
            AIへ送信します。ニックネームはユーザーメモリ生成の入力に使用しません。
          </li>
          <li>
            <strong>共有と利用の制限：</strong>
            Googleユーザーデータは、本サービスの本人確認・アカウント管理・利用者向け機能の提供に必要な範囲で利用します。
            保存・処理の委託先はCloudflareです。Googleユーザーデータを販売せず、広告・信用評価・融資の目的で利用・提供しません。
            汎用的なAI・機械学習モデルの開発・改善・学習には使用せず、その目的で第三者に提供しません。
            Google Workspace APIのデータも、そのようなモデルの開発・改善・学習に使用しません。
          </li>
          <li>
            <strong>保存期間と削除：</strong>
            Googleログイン情報はアカウントを維持する間保存し、「プロフィール」から退会すると削除します。
            Googleアカウントの接続管理から連携を解除することもできますが、連携解除だけでは保存済みデータは削除されません。
            詳しくは<a href="#retention">保存期間・削除・連携解除</a>をご確認ください。
          </li>
        </ul>
        <p>
          Pufu LensによるGoogle APIから受け取った情報の利用および他のアプリへの転送は、Limited
          Useの要件を含む
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          に従います。
        </p>
      </>
    ),
  },
  {
    id: 'purposes',
    title: '4. 情報の利用目的',
    content: (
      <ul>
        <li>本人確認、ログイン状態の維持、利用者ごとのデータ管理。</li>
        <li>記事の取得・保存・検索、要約・問い・気づき・メモリ・プ譜の生成と表示。</li>
        <li>利用者が設定したプロジェクトの公開や外部サービスとの連携。</li>
        <li>利用量の制限、不正利用の防止、障害対応、問い合わせへの対応。</li>
      </ul>
    ),
  },
  {
    id: 'processors',
    title: '5. 外部サービスとAI処理',
    content: (
      <>
        <p>
          本サービスはCloudflareの配信・データベース・ストレージ・AI処理基盤を利用します。
          AI生成に必要な範囲で、記事本文・タイトル・要約、メモ、プロジェクト名・概要、自己紹介、メモリ、問い・気づき、課題、プ譜などをCloudflare
          Workers AIに送信します。プロフィールの自己紹介はユーザーメモリの生成に利用します。
          機密情報や、送信する権限のない個人情報を入力しないでください。
        </p>
        <p>
          Googleログイン情報は前節に記載した用途で使用し、第三者に販売しません。
          利用者の情報は、サービス提供に必要な委託、利用者が許可した連携・公開、法令に基づく場合を除き、第三者へ提供しません。
          外部サービスの設備により、日本国外で情報が処理される場合があります。
        </p>
        <ul>
          <li>
            <strong>Google：</strong>ログインに利用します。Googleによる情報の取り扱いは
            <a href="https://policies.google.com/privacy">Googleのプライバシーポリシー</a>
            をご確認ください。
          </li>
          <li>
            <strong>Cloudflare：</strong>本サービスの配信・保存・AI処理を行います。
            <a href="https://www.cloudflare.com/privacypolicy/">Cloudflareのプライバシーポリシー</a>
            と
            <a href="https://developers.cloudflare.com/workers-ai/platform/data-usage/">
              Workers AIのデータの取り扱い
            </a>
            をご確認ください。
          </li>
          <li>
            <strong>YouTube：</strong>
            一覧ではYouTubeの配信サーバーからサムネイル画像を読み込みます。画像の読み込み時には、IPアドレス・ブラウザ情報などがGoogleに送信されます。
            動画URLの詳細画面では、プライバシー強化モードの埋め込みプレーヤーを表示します。プレーヤーの読み込み・再生時には、ブラウザからYouTubeへ接続し、IPアドレス・ブラウザ情報・接続元サイトの情報などがGoogleに送信されます。
            Googleによる情報の取り扱いは
            <a href="https://policies.google.com/privacy">Googleのプライバシーポリシー</a>
            をご確認ください。
          </li>
          <li>
            <strong>X：</strong>
            利用者が登録した認証トークンをXのAPIに送信し、指定された投稿を取得します。
            Xによる取り扱いは<a href="https://x.com/ja/privacy">Xのプライバシーポリシー</a>
            に従います。
          </li>
          <li>
            <strong>ChatGPTなどのMCP接続先：</strong>
            利用者が許可した操作と対象プロジェクトの範囲で、ストック・要約・問い・気づきなどを接続先に返します。
            接続先でのデータの取り扱いは、そのサービスの規約・ポリシーをご確認ください。
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'publication',
    title: '6. プロジェクトを公開した場合',
    content: (
      <>
        <p>
          プロジェクトを公開すると、プロジェクト名・公開用の紹介文、ストックのタイトル・URL・要約・要点・トピック、問い・気づき、紐づくプ譜の最新局面・振り返りが、ログインしていない人にも閲覧可能になります。
          トップページの公開プロジェクト一覧にも掲載されます。公開前に、第三者の個人情報や機密情報が含まれていないか確認してください。
        </p>
        <p>
          メモリ・個人メモ・取得した本文・内部用のプロジェクト概要は公開しません。
          公開設定をオフにして保存すると、本サービスの公開ページから閲覧できなくなります。
          すでに第三者がコピーした内容や検索エンジンのキャッシュは、本サービスで削除できない場合があります。
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: '7. Cookie・ブラウザ保存・通信情報',
    content: (
      <>
        <p>
          表示言語の設定はブラウザのローカルストレージに保存します。
          ログイン状態の維持にCookie（有効期限30日）、Googleログイン時の安全確認に一時Cookie（10分）を利用します。
          表示テーマの設定はブラウザのローカルストレージとCookie（1年）に保存します。
          Cookieを無効にすると、ログインなど一部の機能を利用できない場合があります。
        </p>
        <p>
          ページの配信、Google
          FontsのフォントやYouTube埋め込みプレーヤーの読み込み、外部リンクの利用時には、IPアドレスやブラウザ情報などが各配信先に送信されることがあります。
          Cloudflareなどの基盤サービスは、安全な配信や障害対応のため通信ログを取り扱います。
          本サービス独自の広告配信や広告目的のアクセス解析は組み込んでいません。YouTubeの埋め込みプレーヤー内では、YouTube側の広告が表示される場合があります。
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    title: '8. 保存期間・削除・連携解除',
    content: (
      <>
        <p>
          登録情報と保存したコンテンツは、サービス提供に必要な期間保存します。
          ストック・問い・気づき・プロジェクトは、対応する画面から削除できます。
          プ譜を削除する場合は、紐づく問い・気づき・ストックまたはプロジェクトを削除してください。
          ストックやプロジェクトを削除すると、紐づく問い・気づき・プ譜も削除されます。
          他のプロジェクトでも参照されている記事は、その保存が残る間保持されます。参照がなくなった本文の削除と、関連メモリの更新は順次処理します。
          不正利用の防止に必要な利用履歴や、法令上保持が必要な情報は、コンテンツの削除後も必要な範囲で保持する場合があります。
        </p>
        <ul>
          <li>プロフィールは「プロフィール」で変更でき、自己紹介も削除できます。</li>
          <li>
            MCP接続やXの登録トークンは「外部連携」、APIトークンは「ショートカット連携」から解除・失効できます。
            連携を解除しても、保存済みのストックや接続先がすでに受け取ったデータは削除されません。
          </li>
          <li>
            Googleとの連携は
            <a href="https://myaccount.google.com/connections">Googleアカウントの接続管理</a>
            から解除できます。Google連携の解除やログアウトは、本サービスに保存したデータの削除を意味しません。
          </li>
          <li>
            退会は「プロフィール」の「退会する」から行えます。登録データと保存本文を削除し、連携を無効にします。削除が完了するまで後処理を継続する場合があります。削除したデータは復元できません。
          </li>
          <li>
            画面から行えない開示・訂正・削除・利用停止は、末尾の窓口へご連絡ください。
            本人確認のうえ、適用される法令に従い対応します。
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'security',
    title: '9. 安全管理',
    content: (
      <p>
        運営者は、暗号化通信、利用者ごとのアクセス制御、認証情報の保護などにより、不正アクセスや漏えいの防止に努めます。
        利用者も、Googleアカウントや連携トークンを適切に管理し、第三者に共有しないでください。
      </p>
    ),
  },
  {
    id: 'changes',
    title: '10. ポリシーの変更',
    content: (
      <p>
        運営者は、法令やサービスの変更に応じて本ポリシーを改定することがあります。
        重要な変更は、本サービス上など適切な方法で周知し、法令上必要な場合は利用者の同意を得ます。
        最新の内容と改定日は、このページに掲載します。
      </p>
    ),
  },
  { id: 'contact', title: '11. 運営者・お問い合わせ', content: <Contact /> },
];

const termsSections: Section[] = [
  {
    id: 'application',
    title: '第1条 適用と同意',
    content: (
      <p>
        この利用規約（以下「本規約」）は、Pufu Lens 運営者（以下「運営者」）が提供する「Pufu
        Lens」（以下「本サービス」）の利用条件を定めます。 利用者は、本規約と
        <a href="/privacy?lang=ja">プライバシーポリシー</a>
        を確認し、初回ログイン後の画面でニックネーム（表示名）を入力して表示言語を選び、両方への同意にチェックして「OK」を押すと利用を開始できます。登録と同意が完了するまでは、再度ログインしても同じ画面を表示します。
      </p>
    ),
  },
  {
    id: 'service',
    title: '第2条 サービスの内容',
    content: (
      <p>
        本サービスは、記事やテキストのストック、プロジェクトごとの整理、AIによる要約・問い・気づき・メモリ・プ譜の生成、プロジェクトの公開、外部サービスとの連携を提供します。
        YouTubeはURL・メモをストックに保存し、一覧にサムネイル画像、詳細にYouTubeの埋め込みプレーヤーを表示します。本サービスのサーバーで動画情報を取得・保存したり、動画の内容に基づく要約・問い・気づき・メモリを生成したりはしません。利用者がメモを記入した場合は、そのメモだけをメモリの更新に利用します。動画によっては埋め込み再生できない場合があります。
        機能によってGoogleログイン、外部サービスの設定や利用権限が必要です。
        利用件数・AI処理などには制限があり、外部サービスの仕様や稼働状況によって利用できない場合があります。
        通信費や、利用者が契約する外部サービスの費用は利用者が負担します。
      </p>
    ),
  },
  {
    id: 'account',
    title: '第3条 アカウントと外部連携の管理',
    content: (
      <p>
        利用者は、自身のGoogleアカウントおよび連携用トークンを適切に管理してください。
        外部サービスとの接続時は、許可する操作と対象プロジェクトを確認してください。
        不正利用の疑いがある場合は、該当する連携を解除・失効し、運営者へご連絡ください。
      </p>
    ),
  },
  {
    id: 'rights',
    title: '第4条 保存・公開するコンテンツの権利',
    content: (
      <>
        <p>
          利用者が登録したコンテンツの権利は、利用者または元の権利者に帰属します。
          取得対象の選択、および取得・保存・利用に必要な権利や許可の確認は、利用者の責任で行うものとします。
          利用者は、保存・入力・公開に必要な権利や許可を確保し、著作権、プライバシー、秘密保持義務、取得元の利用条件などを守ってください。
          URLを保存できることは、取得先の内容を自由に転載・公開できることを意味しません。
        </p>
        <p>
          利用者は、保存・表示・AI生成・許可した連携や公開など、本サービスの提供に必要な範囲で、運営者が登録コンテンツを取り扱うことを認めるものとします。
          公開をオンにすると、要約・問い・気づき・プ譜などがログインなしで閲覧可能になります。公開範囲は
          <a href="/privacy?lang=ja#publication">プライバシーポリシー</a>
          を確認し、個人情報・機密情報や権利侵害がないことを確認してから公開してください。
        </p>
      </>
    ),
  },
  {
    id: 'ai',
    title: '第5条 AI生成情報の取り扱い',
    content: (
      <p>
        要約・問い・気づき・メモリ・プ譜などのAI生成結果には、誤り、情報の欠落、偏りが含まれることがあります。
        運営者は、その正確性・完全性や特定の目的への適合性を保証しません。
        利用者は原文や信頼できる情報源と照合し、必要に応じて専門家に相談したうえで、自身の判断で利用してください。
        外部のAI処理への送信内容は<a href="/privacy?lang=ja#processors">プライバシーポリシー</a>
        に記載しています。
      </p>
    ),
  },
  {
    id: 'prohibited',
    title: '第6条 禁止事項',
    content: (
      <ul>
        <li>法令、公序良俗、本規約に違反する行為。</li>
        <li>第三者の著作権、プライバシー、名誉その他の権利を侵害する行為。</li>
        <li>不正アクセス、他人へのなりすまし、認証情報の不正な使用・共有。</li>
        <li>有害なプログラムの送信、サービスへの過度な負荷、利用制限の回避。</li>
        <li>権限のない情報の取得・保存・公開、外部サービスの規約やアクセス制限に反する利用。</li>
        <li>本サービスの運営や、ほかの利用者の利用を妨げる行為。</li>
      </ul>
    ),
  },
  {
    id: 'external-services',
    title: '第7条 外部サービス',
    content: (
      <>
        <p>
          Google、Cloudflare、X、ChatGPTなどの外部サービスの利用には、それぞれの利用条件が適用されます。
          YouTubeの埋め込みプレーヤーの利用には
          <a href="https://www.youtube.com/t/terms">YouTubeの利用規約</a>
          が適用されます。
        </p>
        <p>
          外部サービスの変更・停止・制限により、本サービスの一部を利用できなくなる場合があります。
          連携先に送信した情報の管理・削除は、連携先の機能やポリシーも確認してください。
        </p>
      </>
    ),
  },
  {
    id: 'suspension',
    title: '第8条 変更・中断・利用制限',
    content: (
      <p>
        運営者は、保守、障害、セキュリティ対応、外部サービスの停止などにより、本サービスを変更・中断・終了することがあります。
        重要な変更や終了は、緊急時ややむを得ない場合を除き、事前に本サービス上などでお知らせします。
        規約違反や不正利用が確認された場合、被害を防ぐために必要な範囲で、利用制限や公開コンテンツの非表示などの措置を取ることがあります。
      </p>
    ),
  },
  {
    id: 'liability',
    title: '第9条 保証と責任',
    content: (
      <p>
        運営者は、本サービスの継続的な提供、保存情報の完全な保持、外部コンテンツやAI生成結果の正確性を保証するものではありません。
        重要な情報は、利用者自身でも控えを保管してください。
        本サービスに関する運営者の責任は、適用される法令に従います。本規約は、運営者の故意・重過失による責任や、消費者保護法令により制限できない責任を免除・制限するものではありません。
      </p>
    ),
  },
  {
    id: 'termination',
    title: '第10条 利用終了とデータの削除',
    content: (
      <p>
        利用者はいつでも利用を終了できます。保存コンテンツは対応する画面から削除し、外部連携は各設定から解除できます。
        アカウント情報の削除など画面で行えない手続きは、末尾の窓口へご連絡ください。
        ログアウトやGoogle連携の解除だけでは、保存したデータは削除されません。詳細は
        <a href="/privacy?lang=ja#retention">プライバシーポリシーの削除方法</a>
        をご確認ください。
      </p>
    ),
  },
  {
    id: 'changes',
    title: '第11条 規約の変更',
    content: (
      <p>
        運営者は、法令に従い本規約を変更することがあります。
        変更内容と効力発生日は、事前に本サービス上など適切な方法でお知らせし、法令上必要な場合は利用者の同意を得ます。
      </p>
    ),
  },
  {
    id: 'law',
    title: '第12条 準拠法',
    content: (
      <p>本規約は日本法に準拠します。ただし、適用される強行法規による利用者の権利を妨げません。</p>
    ),
  },
  { id: 'contact', title: '第13条 運営者・お問い合わせ', content: <Contact /> },
];

function inlineLegal(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`)/g).map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link)
      return (
        <a
          key={index}
          href={link[2]}
          target={link[2].startsWith('https://') ? '_blank' : undefined}
          rel={link[2].startsWith('https://') ? 'noreferrer' : undefined}
        >
          {link[1]}
        </a>
      );
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

export default function LegalPage({
  page,
  language: explicitLanguage,
}: {
  page: 'privacy' | 'terms';
  language?: Language;
}) {
  const current = useLanguage();
  const language = explicitLanguage ?? current.language;
  const english = language === 'en';
  const title =
    page === 'privacy'
      ? english
        ? 'Privacy Policy'
        : 'プライバシーポリシー'
      : english
        ? 'Terms of Service'
        : '利用規約';
  const updated = legalVersions[page];
  const sections: Section[] = english
    ? legalEn[page].map((section) => ({
        id: section.id,
        title: section.title,
        content: (
          <>
            {section.blocks.map((block, index) =>
              block.type === 'list' ? (
                <ul key={index}>
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{inlineLegal(item)}</li>
                  ))}
                </ul>
              ) : (
                <p key={index}>{inlineLegal(block.text)}</p>
              ),
            )}
          </>
        ),
      }))
    : page === 'privacy'
      ? privacySections
      : termsSections;
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | Pufu Lens`;
    document.documentElement.lang = language;
    document.documentElement.dir = languages[language].direction;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    return () => {
      document.title = previousTitle;
    };
  }, [title, language]);
  return (
    <div className="public-page legal-page" lang={language}>
      <header className="public-header">
        <a href="/" className="brand">
          <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />
          <span>Pufu Lens</span>
        </a>
        <a href="/" className="text-link">
          {english ? 'Back to home' : 'トップへ戻る'}
        </a>
      </header>
      <main className="manual-main legal-main">
        <header className="page-header" id="legal-start" tabIndex={-1}>
          <div>
            <h1>{title}</h1>
            <p>
              {english ? 'Established: ' : '制定日：'}
              <time dateTime="2026-10-19">{english ? 'October 19, 2026' : '2026年10月19日'}</time>
              <br />
              {english ? 'Last updated: ' : '最終更新日：'}
              <time dateTime={updated}>{updated.replaceAll('-', '/')}</time>
            </p>
            {english && (
              <p className="manual-note">
                This is an English translation for convenience. The{' '}
                <a href={legalHref(page, 'ja')}>Japanese original</a> governs.
              </p>
            )}
            <nav className="legal-links" aria-label={translateUi(language, 'language.label')}>
              <a
                href={legalHref(page, 'ja')}
                lang="ja"
                aria-current={language === 'ja' ? 'page' : undefined}
              >
                日本語
              </a>
              <a
                href={legalHref(page, 'en')}
                lang="en"
                aria-current={language === 'en' ? 'page' : undefined}
              >
                English
              </a>
            </nav>
          </div>
        </header>
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
        <a className="text-link manual-back-top" href="#legal-start">
          <ArrowUp size={16} aria-hidden="true" />
          {english ? 'Back to top' : 'ページの先頭へ'}
        </a>
        <LegalLinks language={language} />
      </main>
    </div>
  );
}
