import { textLinks } from '../shared/text-links';

export default function LinkedText({ text }: { text: string }) {
  return textLinks(text).map((part, i) =>
    part.href ? (
      <a key={i} className="body-link" href={part.href} target="_blank" rel="noopener noreferrer">
        {part.text}
      </a>
    ) : (
      part.text
    ),
  );
}
