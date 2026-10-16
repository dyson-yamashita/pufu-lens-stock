import { useEffect, useRef, useState, useId } from 'react';
import { api, ApiError, createRequestId } from './api';

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
  const controller = useRef<AbortController | null>(null);
  const request = useRef<{ bytes: Uint8Array; type: string; id: string } | null>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
      request.current = null;
    },
    [],
  );
  return (
    <div className="image-ocr" aria-busy={busy}>
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
          const current = new AbortController();
          controller.current = current;
          const timer = setTimeout(() => current.abort(), 120000);
          setBusy(true);
          onBusy(true);
          setProgress('画像を送信して読み取り中…');
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (!active()) return;
            const previous = request.current;
            if (
              !previous ||
              previous.type !== file.type ||
              previous.bytes.length !== bytes.length ||
              !bytes.every((value, index) => value === previous.bytes[index])
            )
              request.current = { bytes, type: file.type, id: createRequestId() };
            const result = await api<{ text: string }>('/api/v1/ocr', {
              method: 'POST',
              headers: { 'Content-Type': file.type, 'Idempotency-Key': request.current!.id },
              body: file,
              signal: current.signal,
            });
            if (!active()) return;
            onText(result.text);
            setProgress('読み取りました。誤読がないか本文を確認・修正してください。');
          } catch (error) {
            if (active()) {
              // サーバーで失敗が確定した要求だけ、選び直した際に新しい推論を許可する。
              // 通信失敗・処理中・利用上限では同じ画像のIDを維持する。
              if (error instanceof ApiError && ![409, 429, 500].includes(error.status))
                request.current = null;
              setProgress('');
              setError(
                error instanceof ApiError
                  ? error.message
                  : '画像を読み取れませんでした。通信を確認して再試行するか、本文を入力してください。',
              );
            }
          } finally {
            clearTimeout(timer);
            if (active()) {
              controller.current = null;
              setBusy(false);
              onBusy(false);
            }
          }
        }}
      />
      <p className="profile-hint">
        画像をCloudflareへ送信し、AIで読み取ります（10MB・2,000万画素以下）。画像は保存せず、読み取り結果は再送に備えて30日間保持します。
        読み取り結果を確認・修正してから保存してください。読み取りには利用上限があります。
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
