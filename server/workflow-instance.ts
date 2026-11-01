export function isWorkflowInstanceNotFound(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);
  // ローカル binding は instance.not_found、本番 API / RPC は workflows.api.error.instance.not_found。
  return message === 'instance.not_found' || message.endsWith('.instance.not_found');
}
