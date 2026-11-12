export function BrandMark() {
  return <img className="brand-mark" src="/pufu-lens-logo.png" alt="" width="38" height="38" />;
}

/** The page theme chooses a fixed-color SVG, including in browsers without SVG theme inheritance. */
export default function BrandLogo() {
  return (
    <span className="brand-lockup">
      <BrandMark />
      <img
        className="brand-logo brand-logo-light"
        src="/pufu-lens-wordmark.svg"
        alt="Pufu Lens"
        width="1200"
        height="340"
      />
      <img
        className="brand-logo brand-logo-dark"
        src="/pufu-lens-wordmark-dark.svg"
        alt="Pufu Lens"
        width="1200"
        height="340"
      />
    </span>
  );
}
