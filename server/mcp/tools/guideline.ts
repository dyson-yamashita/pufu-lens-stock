import {
  getPufuGuideline,
  pufuGuidelineSchema,
} from '../../features/pufu/generation/pufu-guideline';
import { result } from '../results';
import type { McpToolContext } from '../tool-context';
import { read } from '../tool-schemas';
export function registerGuidelineTools(context: McpToolContext) {
  const { language, register } = context;
  register(
    'get_pufu_guideline',
    {
      title: 'プ譜の記述ガイドライン',
      description:
        'プ譜の作成・編集・レビューに必要な意味と記述方針を、出典付きの日本語JSONで取得します。create_pufu / update_pufu / add_pufu_phaseの前に参照し、獲得目標・勝利条件・中間目的・施策・廟算八要素の違いと関係を確認してください。sectionで範囲、detailで要約か詳細を指定できます。取得だけで既存プ譜を変更してはいけません。形式制約は作成・編集ツールの入力スキーマが正です。',
      inputSchema: pufuGuidelineSchema,
      annotations: read,
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: [] }] },
    },
    (args) => result(getPufuGuideline(args, language)),
  );
}
