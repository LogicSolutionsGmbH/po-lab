/**
 * Shared helpers for the Logic Heroes example scripts.
 *
 * Zero runtime dependencies — uses only Node built-ins (fetch, FormData, Blob,
 * fs, path), all available on Node 18+. The whole `heroes-cli/` folder is
 * self-contained and can be copied anywhere; nothing here imports from the
 * Logic Heroes monorepo.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

// ---------------------------------------------------------------------------
// Config & environment
// ---------------------------------------------------------------------------

export type Role = 'maker' | 'taker';

export interface Config {
  apiUrl: string;
  makerApiKey?: string;
  takerApiKey?: string;
}

/** Minimal `.env` parser so we don't need the `dotenv` dependency. */
function loadDotEnv(): void {
  const path = join(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function loadConfig(): Config {
  loadDotEnv();
  return {
    apiUrl: (process.env.API_URL ?? 'http://localhost:3401/api').replace(/\/$/, ''),
    makerApiKey: process.env.MAKER_API_KEY,
    takerApiKey: process.env.TAKER_API_KEY,
  };
}

/** Resolve the API key for a role, with a friendly error if it's missing. */
export function keyForRole(config: Config, role: Role): string {
  const key = role === 'maker' ? config.makerApiKey : config.takerApiKey;
  if (!key) {
    const envName = role === 'maker' ? 'MAKER_API_KEY' : 'TAKER_API_KEY';
    throw new Error(
      `Missing ${envName}. Set it in your environment or in a .env file ` +
        `(see .env.example). The "${role}" role needs this key.`,
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  apiKey: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

/** Call a JSON endpoint and return the unwrapped `data` field. */
export async function api<T = any>(config: Config, opts: ApiOptions): Promise<T> {
  const url = new URL(config.apiUrl + opts.path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    method: opts.method,
    headers: {
      'x-api-key': opts.apiKey,
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    // The API returns rich messages (e.g. "Only the target tenant can accept
    // or reject a handshake request") — surface them verbatim.
    const message = json?.message ?? json?.error ?? text ?? res.statusText;
    throw new ApiError(res.status, `${res.status} ${message}`, json);
  }

  return (json?.data ?? json) as T;
}

// ---------------------------------------------------------------------------
// Payload folders & attachments
// ---------------------------------------------------------------------------

/** Inline-payload size cap enforced by the API (event.payload max length). */
const INLINE_LIMIT = 8192;

const MIME: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  pdf: 'application/pdf',
  edi: 'application/edi-x12',
};

export interface Payload {
  filename: string;
  ext: string;
  contentType: string;
  data: Buffer;
}

/**
 * Read the single payload file out of a folder. Format-agnostic: the file can
 * be JSON, XML, or anything else — the content type is inferred from the
 * extension and defaults to application/octet-stream.
 */
export function readPayloadFolder(folder: string): Payload {
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new Error(`Payload folder not found: ${folder}`);
  }
  const files = readdirSync(folder).filter(
    (f) => !f.startsWith('.') && statSync(join(folder, f)).isFile(),
  );
  if (files.length === 0) throw new Error(`No payload file found in ${folder}`);
  if (files.length > 1) {
    throw new Error(
      `Expected exactly one payload file in ${folder}, found ${files.length}: ${files.join(', ')}`,
    );
  }
  const filename = files[0];
  const ext = extname(filename).slice(1).toLowerCase();
  return {
    filename,
    ext,
    contentType: MIME[ext] ?? 'application/octet-stream',
    data: readFileSync(join(folder, filename)),
  };
}

function isTextLike(contentType: string): boolean {
  return (
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/xml'
  );
}

/** Upload a payload as a multipart attachment against an already-created event. */
async function uploadAttachment(
  config: Config,
  apiKey: string,
  eventId: number | string,
  payload: Payload,
): Promise<void> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([payload.data], { type: payload.contentType }),
    payload.filename,
  );
  form.append('eventIds', String(eventId));

  const res = await fetch(`${config.apiUrl}/events/attachments`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey }, // let fetch set the multipart boundary
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = JSON.parse(text)?.message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new ApiError(res.status, `Attachment upload failed: ${res.status} ${msg}`);
  }
}

export interface EventBody {
  name: string;
  eventAt?: string;
  eventType?: 'ACT' | 'PLN' | 'EST';
  loCode?: string;
  strategy?: Record<string, unknown>;
  payload?: string;
  payloadMeta?: { contentType?: string; filename?: string; ext?: string };
}

export interface CreatedEvent {
  event: any;
  attachmentMode: 'none' | 'inline' | 'multipart';
}

/**
 * Create an event on a service and, if a payload is supplied, attach it.
 *
 * Auto strategy: small text payloads (≤8 KB, text/json/xml) ride inline on the
 * event's `payload` field in a single request; anything larger or binary is
 * uploaded afterwards via the multipart attachments endpoint.
 */
export async function createEventWithAttachment(
  config: Config,
  args: { serviceId: string; apiKey: string; event: EventBody; payload?: Payload },
): Promise<CreatedEvent> {
  const body: EventBody = {
    eventType: 'ACT',
    eventAt: new Date().toISOString(),
    ...args.event,
  };

  const { payload } = args;
  const inline =
    !!payload &&
    isTextLike(payload.contentType) &&
    payload.data.toString('utf8').length <= INLINE_LIMIT;

  if (payload && inline) {
    body.payload = payload.data.toString('utf8');
    body.payloadMeta = {
      contentType: payload.contentType,
      filename: payload.filename,
      ext: payload.ext,
    };
  }

  const event = await api<any>(config, {
    method: 'POST',
    path: `/services/${args.serviceId}/events`,
    apiKey: args.apiKey,
    body,
  });

  if (payload && !inline) {
    await uploadAttachment(config, args.apiKey, event.id, payload);
  }

  return { event, attachmentMode: payload ? (inline ? 'inline' : 'multipart') : 'none' };
}

// ---------------------------------------------------------------------------
// CLI argument parsing & output
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Tiny arg parser: `--key value`, `--flag`, and positionals. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

export function flagString(flags: ParsedArgs['flags'], key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

/** Wrap a command's main(): load config, run, and print errors cleanly. */
export async function run(main: (config: Config) => Promise<void>): Promise<void> {
  try {
    await main(loadConfig());
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`\n✖ ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`\n✖ ${err.message}`);
    } else {
      console.error('\n✖ Unexpected error:', err);
    }
    process.exit(1);
  }
}

export function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

export function kv(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(16)} ${value}`);
}
