import { getResolvedPDFJS } from 'unpdf';

class PdfContentError extends Error {}

export async function extractPdf(
  data: Uint8Array,
  url: URL,
  assets?: Pick<Fetcher, 'fetch'>,
  signal?: AbortSignal,
): Promise<{ title: string; text: string }> {
  const { getDocument } = await getResolvedPDFJS();
  signal?.throwIfAborted();
  // URLを渡さず取得済みバイト列だけを解析し、外部のフォント等も読み込まない。
  const task = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true,
    useWorkerFetch: false,
    BinaryDataFactory: class {
      async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
        if (kind !== 'cMapUrl' || !/^[A-Za-z0-9_-]+\.bcmap$/.test(filename) || !assets)
          throw new Error('PDFの文字対応表を読み込めませんでした。');
        const response = await assets.fetch(`https://assets.invalid/pdf-cmaps/${filename}`);
        if (!response.ok) throw new Error('PDFの文字対応表を読み込めませんでした。');
        return new Uint8Array(await response.arrayBuffer());
      }
    },
    maxImageSize: 0,
    verbosity: 0,
  });
  const abort = () => {
    void task.destroy().catch(() => undefined);
  };
  signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const pdf = await task.promise;
        if (pdf.numPages > 100)
          throw new PdfContentError('PDFのページ数が多すぎます（上限100ページ）。');
        let text = '';
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number);
          const reader = page.streamTextContent().getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              for (const item of value.items) {
                if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
                if (text.length > 120000)
                  throw new PdfContentError(
                    '本文が長すぎます（上限12万文字）。URLは保存されています。',
                  );
              }
            }
          } finally {
            await reader.cancel(new Error('PDF text extraction ended'));
            page.cleanup();
          }
          text += '\n\n';
          if (text.length > 120000)
            throw new PdfContentError('本文が長すぎます（上限12万文字）。URLは保存されています。');
        }
        text = text
          .replace(/[\t ]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (text.length < 200)
          throw new PdfContentError(
            'PDFの文字情報を十分に取得できませんでした。画像のみのPDFには対応していません。本文を補完して再試行してください。',
          );
        const { info } = await pdf.getMetadata();
        const metadataTitle =
          'Title' in info && typeof info.Title === 'string' ? info.Title.trim() : '';
        const title =
          metadataTitle ||
          text
            .split('\n')
            .find((line) => line.trim().length >= 4)
            ?.trim() ||
          url.hostname;
        return { title: title.slice(0, 300), text };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new PdfContentError(
                'PDFの解析が時間内に完了しませんでした。本文を補完して再試行してください。',
              ),
            ),
          20000,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof PdfContentError) throw error;
    throw new Error(
      'PDFを読み取れませんでした。ファイルの破損やパスワード保護を確認するか、本文を補完して再試行してください。',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await task.destroy();
  }
}
