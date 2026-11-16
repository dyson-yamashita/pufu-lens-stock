// 宣言サイズだけに頼らず、ストリームの実バイト数でも上限を守る。
export async function limitedBytes(
  response: Response,
  maxBytes: number,
  message: string,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('Content-Length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error(message);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const abort = () => {
    // 切断された入力のcancelが拒否されても、元の中断理由を保持する。
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(message);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel();
  }
}
