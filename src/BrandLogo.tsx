export function BrandMark() {
  return <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />;
}

/** Embedded SVG follows the parent color-scheme, including a manually selected theme. */
export default function BrandLogo() {
  return (
    <span className="brand-lockup">
      <BrandMark />
      <img
        className="brand-logo"
        src="/pufu-lens-wordmark.svg"
        alt="Pufu Lens"
        width="1200"
        height="340"
      />
    </span>
  );
}
