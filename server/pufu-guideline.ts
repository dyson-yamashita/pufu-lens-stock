import { z } from 'zod';

export const pufuGuidelineSchema = z.strictObject({
  section: z
    .enum(['all', 'principles', 'goals', 'purposes', 'measures', 'elements', 'review'])
    .default('all')
    .describe('取得する記述ガイドラインの範囲。allは全項目です。'),
  detail: z
    .enum(['summary', 'full'])
    .default('full')
    .describe('summaryは定義と要点、fullは記述例・チェック観点・作成手順も返します。'),
});

type Options = z.infer<typeof pufuGuidelineSchema>;
type Section = Exclude<Options['section'], 'all'>;
type Guideline = {
  label: string;
  definition: string;
  guidance: string[];
  examples?: string[];
  checks: string[];
  process?: string[];
  items?: Record<string, Guideline>;
};

// 意味の指針を管理する静的資料。機械的な形式制約は既存の作成・編集スキーマを正とする。
const sections: Record<Section, Record<string, Guideline>> = {
  principles: {
    principles: {
      label: '基本原則',
      definition: 'プ譜は、当事者の意志、現在の状況、望む未来、実現のための働きかけを表現する。',
      guidance: [
        '作業手順書やWBSとしてではなく、現時点の認識と方針を表すスナップショットとして使い、試行錯誤で更新する。',
        '当事者の価値観・言葉・文脈を尊重し、AIの一般論に置き換えない。',
        '事実、当事者の認識、AIの推測、未確認事項を区別し、不明な内容を創作して確定しない。',
        '一枚で全体を俯瞰できるよう、重要な内容を簡潔にまとめる。施策と状態の因果関係は仮説であり、成功の保証ではない。',
        '作成・編集には本ガイドラインを参照する。解釈にはget_pufu、表示だけならshow_pufuを使い、表示のための取得は必須としない。',
        '取得だけで既存プ譜を自動修正しない。ユーザーの依頼範囲に従い、編集時は既存の意志・構造と変更しない項目を保持する。',
        'JSON構造・UUID・色・進捗等の形式はcreate_pufu / update_pufuの入力スキーマを正とする。',
      ],
      process: [
        '問い・ストック・対話から当事者の関心とプロジェクトの背景を把握する。',
        '獲得目標の候補を整理する。',
        '廟算八要素から現在の条件・資源・制約を把握する。',
        '勝利条件を仮説として考え、当事者の願いと整合するか確認する。',
        '勝利条件に必要な状態を中間目的に整理する。',
        '各中間目的へ寄与する施策を考える。',
        '全体の整合性・優先順位・一覧性を確認する。不足情報は創作で埋めない。',
        '依頼範囲に従って作成・登録・更新する。',
      ],
      checks: ['当事者の意志を勝手に変更していないか。', '推測を事実として確定していないか。'],
    },
  },
  goals: {
    gainingGoal: {
      label: '獲得目標',
      definition: '取り組みを通じて生み出す、または手に入れようとする成果物や事柄。',
      guidance: [
        '「何を得るのか」を具体化する。有形の製品に限らず、サービス、組織、事業、経験も含む。',
        '詳細な機能一覧やWBSにせず、利用後の望ましい状態を示す勝利条件と区別する。',
        '内容が未確定なら曖昧さを残してよい。',
      ],
      examples: ['問いとプ譜を一体的に管理できるWebサービス「Pufu Lens」。'],
      checks: ['得ようとする対象を書いているか。', '成果物の先の状態と混同していないか。'],
    },
    winCondition: {
      label: '勝利条件',
      definition: '取り組みが成就したと当事者が納得できる、望ましい状況。',
      guidance: [
        '獲得目標を得ることで、どのような状況を迎えたいかを書く。完成・納品だけで判断しない。',
        '意義と実現可能性を感じられ、優先順位や施策の発想につながる表現を目指す。',
        '定性的・比喩的な表現も許容し、数値目標・KPI・SMART基準を無理に適用しない。',
        'まだ見定められていない場合は仮説として扱う。',
      ],
      examples: ['利用者が日常の関心から問いを育て、選んだ問いを具体的な行動へつなげられている。'],
      checks: ['当事者にとって成就といえる状態か。', '獲得目標の完成だけを言い換えていないか。'],
    },
  },
  purposes: {
    purposes: {
      label: '中間目的',
      definition: '勝利条件の成立に必要な、部分的に満たされていてほしい状態。',
      guidance: [
        '作業・機能名・タスクをそのまま書かず、「何がどうなっている必要があるか」を状態として表す。',
        '観点のバランスと優先順位を考え、原則2〜3個程度を推奨する。',
        '4個以上も許容する。一覧性のための集約は検討するが、数合わせの項目を追加しない。',
      ],
      examples: [
        '利用者が自分の関心に沿って問いを見つけられる状態。',
        '選んだ問いをプ譜にして行動を検討できる状態。',
        '人とAIが過去の思考を引き継いで対話できる状態。',
      ],
      checks: ['作業ではなく状態を表しているか。', '勝利条件に寄与し、全体を俯瞰できるか。'],
    },
  },
  measures: {
    measures: {
      label: '施策',
      definition: '対応する中間目的を実現するための、具体的な働きかけ。',
      guidance: [
        '何をするのかが分かる行動とし、対応する中間目的との関係を説明できるようにする。',
        '効果は作業仮説として扱い、結果を保証しない。複数の選択肢を考え、特定の手段へ固執しない。',
        '費用・時間・実行可能性を考慮し、すべての作業を網羅しようとしない。',
        '初期案は中間目的ごとに1〜3件程度を目安とする。これはPufu Lens独自の運用上の推奨であり、必須制約ではない。',
      ],
      examples: [
        'ストックと問いの関係を視覚的に表示する。',
        '問いからプ譜への作成導線を用意する。',
        'MCPでストック・問い・プ譜を取得可能にする。',
      ],
      checks: [
        '対応する中間目的へ寄与する仮説になっているか。',
        '他の手段や実行コストを検討したか。',
      ],
    },
  },
  elements: {
    elements: {
      label: '廟算八要素',
      definition:
        'プロジェクトを取り巻く所与の資源・条件・制約について、現時点で把握している状況。',
      guidance: [
        '理想や施策ではなく、現在の認識を書く。必要なら必達・制約条件、有利な条件、不利な条件の観点で考える。',
        '事実、当事者の認識、AIの推測を区別する。情報がなければ空欄も許容し、八要素を埋めるための内容を創作しない。',
        'ライバルと外敵を区別し、一般的な不確実性や作業課題を機械的に外敵へ分類しない。',
      ],
      items: {
        people: {
          label: 'ひと',
          definition: '当事者・関係者の能力、強み・弱み、動機、利害、関心、価値観、行動原理。',
          guidance: ['単なる参加者一覧にせず、把握している特徴や関係を書く。'],
          checks: ['能力や動機を根拠なく推測していないか。'],
        },
        money: {
          label: 'お金',
          definition: '予算、費用、資金調達、収益、支出に関する条件や制約。',
          guidance: ['根拠のない金額を生成しない。'],
          checks: ['金額と資金の条件に根拠があるか。'],
        },
        time: {
          label: '時間',
          definition: '期限、リードタイム、関係者の可処分時間、時間的な猶予。',
          guidance: ['未設定の期限を創作しない。'],
          checks: ['期限や使える時間は確認されたものか。'],
        },
        quality: {
          label: 'クオリティ',
          definition: '成果物に期待する品質、完成度、満足度、技術水準と、それらを制約する条件。',
          guidance: ['既存技術と実現可能な品質の限界も考慮する。'],
          checks: ['品質の期待と現在の条件を区別しているか。'],
        },
        businessScheme: {
          label: '商流・座組',
          definition: '契約関係、責任範囲、意思決定権、指揮系統、組織間の関係。',
          guidance: ['現在把握している役割・権限・関係を書く。'],
          checks: ['未確認の契約や権限を決めつけていないか。'],
        },
        environment: {
          label: '環境',
          definition: '活動領域や国・地域・業界・組織の文化、風土、慣習、制度、外部条件。',
          guidance: ['取り組みに影響する現在の外部条件を整理する。'],
          checks: ['一般論だけで環境を断定していないか。'],
        },
        rival: {
          label: 'ライバル',
          definition: '同じ成果や資源を取り合う存在。',
          guidance: ['協働や相互作用の可能性もあるため、敵対者と決めつけない。'],
          checks: ['外敵と混同していないか。'],
        },
        foreignEnemy: {
          label: '外敵',
          definition: '目標の達成やプロジェクトの存続を積極的に妨げる存在・状況。',
          guidance: ['ライバルとは区別し、一般的な不確実性や単なる作業課題を機械的に分類しない。'],
          checks: ['積極的に妨げるという認識に根拠があるか。'],
        },
      },
      examples: ['予算や期限が未確認であれば、その旨を記すか空欄にして、架空の数字を補わない。'],
      checks: ['現状認識に徹しているか。', '不明な情報を推測で埋めていないか。'],
    },
  },
  review: {
    review: {
      label: 'レビューチェック',
      definition: '内容の改善を支援するための問い。機械的な正誤判定や保存拒否の基準にはしない。',
      guidance: [
        '当事者の意志、要素の意味と相互関係、不確実性、一覧性を確認し、必要なら改善を提案する。',
        'ガイドライン取得やレビューだけで既存プ譜を自動修正せず、ユーザーの依頼範囲を守る。',
      ],
      checks: [
        '獲得目標と勝利条件を混同していないか。',
        '中間目的が作業ではなく状態を表しているか。',
        '各施策が対応する中間目的へ寄与する仮説になっているか。',
        '廟算八要素に推測を事実として書いていないか。',
        'ライバルと外敵を混同していないか。',
        '重要な論点が多すぎて全体像を読みにくくしていないか。',
        '当事者の意志や文脈を勝手に変更していないか。',
      ],
    },
  },
};

const sourcePages: Record<Section, string[]> = {
  principles: ['プ譜とは何か：その成り立ちと基本', 'プ譜の記法論'],
  goals: ['獲得目標', '勝利条件'],
  purposes: ['中間目的'],
  measures: ['施策'],
  elements: ['廟算八要素'],
  review: ['獲得目標', '勝利条件', '中間目的', '施策', '廟算八要素', 'プ譜の記法論'],
};

type Summary = Pick<Guideline, 'label' | 'definition' | 'guidance'> & {
  items?: Record<string, Summary>;
};

function summarize(entry: Guideline): Summary {
  return {
    label: entry.label,
    definition: entry.definition,
    guidance: entry.guidance,
    ...(entry.items
      ? {
          items: Object.fromEntries(
            Object.entries(entry.items).map(([key, value]) => [key, summarize(value)]),
          ),
        }
      : {}),
  };
}

export function getPufuGuideline({ section, detail }: Options) {
  const selected =
    section === 'all'
      ? Object.fromEntries(Object.values(sections).flatMap((value) => Object.entries(value)))
      : sections[section];
  const pages = section === 'all' ? Object.values(sourcePages).flat() : sourcePages[section];
  return {
    version: '1.0.0',
    language: 'ja',
    section,
    detail,
    guidelines:
      detail === 'full'
        ? selected
        : Object.fromEntries(
            Object.entries(selected).map(([key, value]) => [key, summarize(value)]),
          ),
    sources: [...new Set(pages)].map((page) => `https://scrapbox.io/ProjectScore/${page}`),
    attribution:
      'プロジェクト工学フォーラムの解説とユーザー提供の仕様案をもとにPufu Lens向けに再構成したガイドラインです。原著の公式仕様をそのまま転載したものではありません。',
  };
}
