import { minArticleTextLength } from './article-text';

const fileOrigin = 'https://files.speakerdeck.com';
const assetPath = /^\/presentations\/([0-9a-f]{32})\/[^/]+$/i;
const markedList = 'ol.speakerdeck-transcript, .speakerdeck-transcript ol';
const slideLink = `li a[href^="${fileOrigin}/presentations/"]`;
export const speakerDeckLists = `${markedList}, ol:has(${slideLink})`;
export type SpeakerDeckPage = { presentationId?: string; pdfUrl?: URL };

function presentationAssetId(url: URL) {
  return url.origin === fileOrigin ? assetPath.exec(url.pathname)?.[1]?.toLowerCase() : undefined;
}

export function speakerDeckPdfId(url: URL) {
  return /\.pdf$/i.test(url.pathname) ? presentationAssetId(url) : undefined;
}

function transcriptList(document: Document) {
  const marked = document.querySelector(markedList);
  if (marked) return marked;
  let inTranscript = false;
  for (const element of document.querySelectorAll('h1, h2, ol')) {
    if (element.localName !== 'ol') {
      if (inTranscript) break;
      inTranscript = element.textContent?.trim() === 'Transcript';
    } else if (inTranscript && element.querySelector(slideLink)) {
      return element;
    }
  }
  return null;
}

function slideText(slide: Element) {
  for (const block of slide.querySelectorAll('br, div, h3, h4, p, li')) block.before('\n');
  return (slide.textContent ?? '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function assetLinkId(href: string | undefined | null, deckUrl: URL) {
  try {
    return href ? presentationAssetId(new URL(href, deckUrl)) : undefined;
  } catch {
    return undefined;
  }
}

function pdfLink(document: Document, deckUrl: URL, presentationId: string) {
  for (const link of document.querySelectorAll('a[href]')) {
    if (link.closest('[hidden], [aria-hidden="true"], [aria-disabled="true"]')) continue;
    try {
      const target = new URL(link.getAttribute('href') ?? '', deckUrl);
      if (speakerDeckPdfId(target) === presentationId) return target;
    } catch {
      // A malformed link does not prevent reading the transcript.
    }
  }
  return undefined;
}

export function readSpeakerDeck(
  document: Document,
  url: URL,
  initialDeck: SpeakerDeckPage | undefined,
  ogImageUrl?: string,
) {
  if (url.hostname !== 'speakerdeck.com' && url.hostname !== 'www.speakerdeck.com') return;
  const transcript = transcriptList(document);
  const hasEmbed = document.querySelector(
    'link[type="application/json+oembed"][href^="/oembed.json?"], link[type="application/json+oembed"][href^="https://speakerdeck.com/oembed.json?"]',
  );
  if (!initialDeck && !transcript && !hasEmbed) return;
  const slides = Array.from(transcript?.children ?? []).filter(
    (element) => element.localName === 'li',
  );
  const text = slides.map(slideText).filter(Boolean).join('\n\n');
  const title =
    document.querySelector('h1')?.textContent?.trim() || document.title.trim() || url.hostname;
  const embedId = document.querySelector('.speakerdeck-embed[data-id]')?.getAttribute('data-id');
  const presentationId =
    initialDeck?.presentationId ??
    assetLinkId(transcript?.querySelector(slideLink)?.getAttribute('href'), url) ??
    assetLinkId(ogImageUrl, url) ??
    (embedId && /^[0-9a-f]{32}$/i.test(embedId) ? embedId.toLowerCase() : undefined);
  return {
    title: title.slice(0, 300),
    text,
    speakerDeck: {
      presentationId,
      pdfUrl:
        presentationId && text.length < minArticleTextLength
          ? pdfLink(document, url, presentationId)
          : undefined,
    },
  };
}
