import { useEffect, useRef, useState, useId } from 'react';
import type { Worker } from 'tesseract.js';

export default function ImageOcr({
  disabled,
  onText,
  onBusy,
}: {
  disabled: boolean;
  onText: (text: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      generation.current++;
      void worker.current?.terminate();
      worker.current = null;
    },
    [],
  );
  return (
    <div className="image-ocr">
      <label htmlFor={id}>画像から文字を読み取る（日本語・英語）</label>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled || busy}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setError('');
          setProgress('');
          if (
            !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
            file.size > 10 * 1024 * 1024
          ) {
            setError('PNG・JPEG・WebP形式の10MB以下の画像を選んでください。');
            return;
          }
          const run = ++generation.current;
          const active = () => generation.current === run;
          setBusy(true);
          onBusy(true);
          setProgress('読み取りの準備中…');
          let current: Worker | null = null;
          let finished = false;
          let fail: (error: Error) => void = () => {};
          const failure = new Promise<never>((_, reject) => {
            fail = reject;
          });
          const timer = setTimeout(() => fail(new Error('timeout')), 120000);
          const recognize = async () => {
            const bitmap = await createImageBitmap(file);
            const tooLarge = bitmap.width * bitmap.height > 20000000;
            bitmap.close();
            if (tooLarge) throw new Error('large');
            const { createWorker } = await import('tesseract.js');
            if (!active()) return;
            current = await createWorker('jpn+eng', 1, {
              workerPath: '/ocr/worker.min.js',
              corePath: '/ocr/core',
              langPath: '/ocr/lang',
              workerBlobURL: false,
              logger: (message) => {
                if (active())
                  setProgress(
                    message.status === 'recognizing text'
                      ? `読み取り中… ${Math.round(message.progress * 100)}%`
                      : '読み取りの準備中…',
                  );
              },
              // 言語データの初期化失敗でもUIを解除する。ライブラリーの生エラーは表示しない。
              errorHandler: () => fail(new Error('ocr')),
            });
            if (!active() || finished) {
              await current.terminate();
              return;
            }
            worker.current = current;
            const result = await current.recognize(file);
            if (!active() || finished) return;
            const text = result.data.text.trim();
            if (!text) {
              setError('文字を読み取れませんでした。鮮明な画像を選ぶか、本文を入力してください。');
              return;
            }
            onText(text);
            setProgress('読み取りました。誤読がないか本文を確認・修正してください。');
          };
          try {
            await Promise.race([recognize(), failure]);
          } catch {
            if (active()) {
              setProgress('');
              setError(
                '画像を読み取れませんでした。2,000万画素以下の鮮明な画像で再試行するか、本文を入力してください。',
              );
            }
          } finally {
            finished = true;
            clearTimeout(timer);
            await (current as Worker | null)?.terminate();
            if (active()) {
              worker.current = null;
              setBusy(false);
              onBusy(false);
            }
          }
        }}
      />
      <p className="profile-hint">
        画像はこの端末内で処理し、アップロードしません。保存すると、確認した本文が通常のストックとして保存・要約されます。
      </p>
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
