export default function LegalLinks({ newTab = false }: { newTab?: boolean }) {
  return (
    <nav className="legal-links" aria-label="ポリシーと利用規約">
      {[
        ['/privacy', 'プライバシーポリシー'],
        ['/terms', '利用規約'],
      ].map(([href, label]) => (
        <a
          key={href}
          href={href}
          target={newTab ? '_blank' : undefined}
          rel={newTab ? 'noreferrer' : undefined}
          aria-label={newTab ? `${label}（新しいタブで開く）` : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
