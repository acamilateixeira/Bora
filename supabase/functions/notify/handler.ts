// Lógica da Edge Function `notify`, sem dependências de Deno ou do Supabase.
// O index.ts injeta as dependências reais; os testes injetam dublês.

export type NotifyPayload = {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

/** Resposta da API de push do Expo para cada mensagem enviada. */
export type PushTicket =
  | { status: 'ok'; id?: string }
  | { status: 'error'; message?: string; details?: { error?: string } };

export type NotifyDeps = {
  /** Segredo compartilhado com o banco. Sem ele a função recusa todas as chamadas. */
  secret: string;
  fetchTokens: (userId: string) => Promise<string[]>;
  sendPush: (messages: PushMessage[]) => Promise<PushTicket[]>;
  /** Remove tokens que o Expo informou como não registrados. */
  removeTokens: (tokens: string[]) => Promise<void>;
};

export const SECRET_HEADER = 'x-bora-notify-secret';
export const EXPO_BATCH_SIZE = 100;
const MAX_TITLE = 120;
const MAX_BODY = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Comparação em tempo constante para não vazar o segredo por timing. */
export const safeEqual = (a: string, b: string) => {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
};

export const parsePayload = (raw: unknown): NotifyPayload | null => {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.user_id !== 'string' || !UUID.test(p.user_id)) return null;
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > MAX_TITLE) return null;
  if (typeof p.body !== 'string' || !p.body.trim() || p.body.length > MAX_BODY) return null;
  if (p.data !== undefined && (p.data === null || typeof p.data !== 'object' || Array.isArray(p.data))) {
    return null;
  }
  return {
    user_id: p.user_id,
    title: p.title,
    body: p.body,
    data: (p.data as Record<string, unknown> | undefined) ?? {},
  };
};

export const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export const createNotifyHandler = (deps: NotifyDeps) => async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // A chave anon vai dentro do app, então ela não serve como autorização:
  // só o banco (via pg_net) conhece este segredo.
  const provided = req.headers.get(SECRET_HEADER) ?? '';
  if (!deps.secret || !safeEqual(provided, deps.secret)) {
    return json(401, { error: 'unauthorized' });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const payload = parsePayload(raw);
  if (!payload) return json(400, { error: 'invalid_payload' });

  const tokens = [...new Set(await deps.fetchTokens(payload.user_id))];
  if (tokens.length === 0) return json(200, { sent: 0, failed: 0, removed: 0 });

  const messages: PushMessage[] = tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  let sent = 0;
  let failed = 0;
  const stale: string[] = [];
  for (const batch of chunk(messages, EXPO_BATCH_SIZE)) {
    const tickets = await deps.sendPush(batch);
    batch.forEach((msg, i) => {
      const ticket = tickets[i];
      if (ticket?.status === 'ok') {
        sent++;
        return;
      }
      failed++;
      if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        stale.push(msg.to);
      }
    });
  }

  if (stale.length > 0) await deps.removeTokens(stale);

  return json(200, { sent, failed, removed: stale.length });
};
