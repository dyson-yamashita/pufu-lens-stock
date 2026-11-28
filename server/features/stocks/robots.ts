import { limitedBytes } from '../../infrastructure/limited-bytes';

export const crawlerName = 'PufuLens';
const disallowed = 'robots.txt でクロールが禁止されているため、本文を取得できません。';
const unavailable = 'robots.txt を確認できなかったため、本文の取得を見送りました。';
const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_CACHED_ORIGINS = 8;

export class RobotsError extends Error {
  constructor(
    readonly reason: 'robots_disallowed' | 'robots_unavailable',
    readonly httpStatus?: number,
    options?: ErrorOptions,
  ) {
    super(reason === 'robots_disallowed' ? disallowed : unavailable, options);
  }
}
export type RobotsGuard = (url: URL, deadline: number, signal: AbortSignal) => Promise<void>;
type FetchRobots = (
  target: URL,
  deadline: number,
  signal: AbortSignal,
  onResponseStatus: (status: number) => void,
) => Promise<Response>;
type Rule = { allow: boolean; parts: string[]; anchored: boolean; length: number };

// Decode unreserved ASCII and use a consistent UTF-8 escape form for comparison.
function normalizePath(path: string): string {
  return path.replace(/%[0-9a-fA-F]{2}|[^!-~]/gu, (part) => {
    if (!part.startsWith('%')) return encodeURIComponent(part);
    const decoded = String.fromCharCode(Number.parseInt(part.slice(1), 16));
    return /^[a-z0-9._~-]$/i.test(decoded) ? decoded : part.toUpperCase();
  });
}

export function robotsPath(url: URL): string {
  return normalizePath(url.href.slice(url.origin.length))
    .replaceAll('*', '%2A')
    .replaceAll('$', '%24');
}

function parseRules(text: string): Rule[] {
  const specific: Rule[] = [];
  const fallback: Rule[] = [];
  const agent = crawlerName.toLowerCase();
  const group = new Set<string>();
  let hasSpecificGroup = false;
  let hasRules = false;
  for (const line of text.split(/\r\n?|\n/)) {
    const directive = line.split('#', 1)[0];
    const separator = directive.indexOf(':');
    if (separator < 0) continue;
    const field = directive.slice(0, separator).trim().toLowerCase();
    const value = directive.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (!/^(?:[a-z_-]+|\*)$/i.test(value)) continue;
      if (hasRules) group.clear();
      hasRules = false;
      group.add(value.toLowerCase());
      hasSpecificGroup ||= group.has(agent);
      continue;
    }
    if (field !== 'allow' && field !== 'disallow') continue;
    // Some sites publish suffix patterns such as `*.md`.
    if (value && !value.startsWith('/') && !value.startsWith('*')) continue;
    hasRules = true;
    if (!value || (!group.has(agent) && !group.has('*'))) continue;
    const anchored = value.endsWith('$');
    const path = normalizePath(anchored ? value.slice(0, -1) : value).replaceAll('$', '%24');
    const rule = {
      allow: field === 'allow',
      parts: path.split(/\*+/),
      anchored,
      length: path.length + Number(anchored),
    };
    if (group.has(agent)) specific.push(rule);
    if (group.has('*')) fallback.push(rule);
  }
  return hasSpecificGroup ? specific : fallback;
}

function matches(path: string, { parts, anchored }: Rule): boolean {
  const prefix = parts[0];
  if (!path.startsWith(prefix)) return false;
  if (parts.length === 1) return !anchored || path === prefix;
  const suffix = anchored ? parts[parts.length - 1] : '';
  if (!path.endsWith(suffix)) return false;
  let offset = prefix.length;
  // Greedily consume literal segments from left to right, without regex backtracking.
  for (let i = 1; i < parts.length - Number(anchored); i++) {
    const index = path.indexOf(parts[i], offset);
    if (index < 0) return false;
    offset = index + parts[i].length;
  }
  return offset <= path.length - suffix.length;
}

async function readRules(
  target: URL,
  deadline: number,
  fetchRobots: FetchRobots,
  requestSignal: AbortSignal,
) {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(20000)]);
  let httpStatus: number | undefined;
  try {
    const response = await fetchRobots(target, deadline, signal, (status) => {
      httpStatus = status;
    });
    httpStatus = response.status;
    if (response.status === 206 || response.headers.has('Content-Range')) {
      await response.body?.cancel();
      throw new Error('Incomplete robots.txt response');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return [];
      throw new Error(`HTTP ${response.status}`);
    }
    const bytes = await limitedBytes(
      response,
      MAX_ROBOTS_BYTES,
      'robots.txt exceeds 512 KiB',
      signal,
    );
    return parseRules(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new RobotsError('robots_unavailable', httpStatus, { cause: error });
  }
}

export function createRobotsGuard(fetchRobots: FetchRobots): RobotsGuard {
  // Share origin policies across navigation and pagination for one extraction.
  const byOrigin = new Map<string, Promise<Rule[]>>();
  return async (url, deadline, signal) => {
    const path = robotsPath(url);
    if (path === '/robots.txt') return;
    let rules = byOrigin.get(url.origin);
    if (!rules) {
      rules = readRules(url, deadline, fetchRobots, signal);
      if (byOrigin.size < MAX_CACHED_ORIGINS) byOrigin.set(url.origin, rules);
    }
    let best: Rule | undefined;
    for (const rule of await rules) {
      if (best && (best.length > rule.length || (best.length === rule.length && best.allow)))
        continue;
      if (matches(path, rule)) best = rule;
    }
    if (best && !best.allow) throw new RobotsError('robots_disallowed');
  };
}
