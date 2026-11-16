import { useState } from 'react';

export default function OgImage({ src }: { src: string | null | undefined }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && src !== failedSrc ? (
    <img
      className="stock-og-image"
      src={src}
      alt=""
      width={600}
      height={315}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
    />
  ) : null;
}
