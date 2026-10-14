// Nodeで工程を検証するための基底クラス。実際の永続実行はローカルWorkersでも確認する。
export class WorkflowEntrypoint<Env> {
  constructor(
    public ctx: ExecutionContext,
    public env: Env,
  ) {}
}
