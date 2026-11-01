import { lookup } from 'node:dns/promises';
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { PassThrough, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { RelayError } from '../utils/relay-error.js';

export interface FetcherDependencies {
  resolve(hostname: string): Promise<{ address: string; family: number }[]>;
  request(options: RequestOptions, onResponse: (response: IncomingMessage) => void): ClientRequest;
  scheduleDeadline(callback: () => void, milliseconds: number): () => void;
}
const defaults: FetcherDependencies = {
  resolve: hostname => lookup(hostname, { all: true, verbatim: true }),
  request: (options, callback) => (options.protocol === 'https:' ? httpsRequest : httpRequest)(options, callback),
  scheduleDeadline: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};
const MAX_BYTES = 1024 * 1024;
const unavailable = () => new RelayError('FETCH_UNAVAILABLE', 'Public HTML could not be fetched within safety limits.');
const unsafe = () => new RelayError('UNSAFE_URL', 'Only public HTTP(S) website addresses without credentials are allowed.');

// Conservative public-unicast allowlist: reject reserved/documentation/transition space too.
function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      address === '168.63.129.16' || // Azure platform virtual address (not a public website).
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6) return false;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const first = Number.parseInt(normalized.split(':')[0]!, 16);
  // This also rejects all IPv4-mapped IPv6, including private mapped addresses.
  if (!(first >= 0x2000 && first <= 0x3fff)) return false;
  const second = Number.parseInt(normalized.split(':')[1] || '0', 16);
  return !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    first !== 0x2002 && !(first === 0x3fff && second < 0x1000);
}
function parseUrl(raw: string): URL {
  let url: URL;
  try {
    if (raw.length > 2048) throw unsafe();
    url = new URL(raw);
  } catch { throw unsafe(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw unsafe();
  url.hash = '';
  return url;
}
function hostOf(url: URL): string { return url.hostname.replace(/^\[|\]$/g, ''); }

function boundedBytes(): Transform {
  let size = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    callback(size > MAX_BYTES ? unavailable() : null, chunk);
  } });
}

export class SafeWebsiteFetcher {
  private readonly dependencies: FetcherDependencies;
  constructor(dependencies: Partial<FetcherDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async fetch(rawUrl: string): Promise<{ url: string; html: string }> {
    const controller = new AbortController();
    const cancelDeadline = this.dependencies.scheduleDeadline(() => controller.abort(), 3500);
    const signal = controller.signal;
    try {
      let url = parseUrl(rawUrl);
      const visited = new Set<string>();
      for (let redirects = 0; ; redirects++) {
        if (signal.aborted) throw unavailable();
        if (visited.has(url.href)) throw unavailable();
        visited.add(url.href);
        const hostname = hostOf(url);
        let addresses: { address: string; family: number }[];
        if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
        else {
          // DNS promises cannot cancel OS resolution. Race it and never connect after abort.
          addresses = await new Promise((resolve, reject) => {
            const abort = () => reject(unavailable());
            signal.addEventListener('abort', abort, { once: true });
            this.dependencies.resolve(hostname).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
          });
        }
        if (signal.aborted) throw unavailable();
        if (!addresses.length || addresses.some(a => !publicAddress(a.address) || isIP(a.address) !== a.family)) throw unsafe();
        const pinned = addresses[0]!;
        const result = await this.hop(url, pinned, signal);
        if ('html' in result) return { url: url.href, html: result.html };
        if (redirects >= 3) throw unavailable();
        url = parseUrl(new URL(result.location, url).href);
      }
    } catch (error) {
      if (error instanceof RelayError) throw error;
      throw unavailable();
    } finally {
      cancelDeadline();
      controller.abort();
    }
  }

  private hop(url: URL, pinned: { address: string; family: number }, signal: AbortSignal): Promise<{ html: string } | { location: string }> {
    return new Promise((resolve, reject) => {
      let response: IncomingMessage | undefined;
      let request: ClientRequest | undefined;
      let settled = false;
      const finish = (error?: unknown, result?: { html: string } | { location: string }) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        response?.destroy();
        request?.destroy();
        if (error) reject(error); else resolve(result!);
      };
      const abort = () => finish(unavailable());
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      try {
        request = this.dependencies.request({
          protocol: url.protocol, hostname: hostOf(url), port: url.port || undefined,
          path: url.pathname + url.search, method: 'GET',
          agent: false, // No pooled socket, proxy environment, or secondary resolver can bypass pinning.
          servername: isIP(hostOf(url)) ? undefined : hostOf(url), rejectUnauthorized: true,
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [pinned]);
            else callback(null, pinned.address, pinned.family);
          },
          headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip, deflate, br', 'User-Agent': 'Relay-Website-Audit/1.0' },
        }, incoming => {
          response = incoming;
          if (settled) { incoming.destroy(); return; }
          const status = incoming.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            // Redirect bodies are never consumed; MIME checks apply only to consumed HTML.
            if (!incoming.headers.location) finish(unavailable());
            else finish(undefined, { location: incoming.headers.location });
            return;
          }
          const mime = incoming.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
          if (status < 200 || status >= 300 || !['text/html', 'application/xhtml+xml'].includes(mime ?? '')) {
            finish(unavailable()); return;
          }
          const encoding = incoming.headers['content-encoding']?.trim().toLowerCase();
          const decoder = !encoding || encoding === 'identity' ? new PassThrough() :
            encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() :
              encoding === 'br' ? createBrotliDecompress() : null;
          if (!decoder) { finish(unavailable()); return; }
          const chunks: Buffer[] = [];
          // Limit both wire and decompressed bytes, including chunked bodies; never buffer unbounded input.
          void pipeline(incoming, boundedBytes(), decoder, boundedBytes(), new Writable({
            write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); },
          })).then(() => finish(undefined, { html: Buffer.concat(chunks).toString('utf8') }), error => finish(error));
        });
        request.on('error', error => finish(error));
        request.end();
      } catch (error) { finish(error); }
    });
  }
}
