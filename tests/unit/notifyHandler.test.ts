import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNotifyHandler,
  EXPO_BATCH_SIZE,
  safeEqual,
  SECRET_HEADER,
  type NotifyDeps,
  type PushMessage,
} from '../../supabase/functions/notify/handler.ts';

const USER = '0b6f2a0e-6a43-4a64-9d3e-0b7c1d0f9a11';
const SECRET = 'segredo-de-teste';

const fakeDeps = (tokens: string[], overrides: Partial<NotifyDeps> = {}) => {
  const sent: PushMessage[][] = [];
  const removed: string[][] = [];
  const deps: NotifyDeps = {
    secret: SECRET,
    fetchTokens: async () => tokens,
    sendPush: async (batch) => {
      sent.push(batch);
      return batch.map(() => ({ status: 'ok' as const }));
    },
    removeTokens: async (t) => {
      removed.push(t);
    },
    ...overrides,
  };
  return { deps, sent, removed };
};

const request = (body: unknown, headers: Record<string, string> = { [SECRET_HEADER]: SECRET }) =>
  new Request('http://localhost/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const valid = { user_id: USER, title: 'Nova corrida', body: 'Você recebeu uma corrida' };

test('recusa chamada sem o segredo, mesmo com a chave anon', async () => {
  const { deps, sent } = fakeDeps(['ExponentPushToken[a]']);
  const res = await createNotifyHandler(deps)(request(valid, { Authorization: 'Bearer anon-key' }));
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0);
});

test('recusa tudo quando a função está sem segredo configurado', async () => {
  const { deps } = fakeDeps(['t'], { secret: '' });
  const res = await createNotifyHandler(deps)(request(valid, { [SECRET_HEADER]: '' }));
  assert.equal(res.status, 401);
});

test('só aceita POST', async () => {
  const { deps } = fakeDeps([]);
  const res = await createNotifyHandler(deps)(new Request('http://localhost/notify'));
  assert.equal(res.status, 405);
});

test('valida o payload', async () => {
  const { deps } = fakeDeps([]);
  const handler = createNotifyHandler(deps);
  assert.equal((await handler(request('{nao-json'))).status, 400);
  assert.equal((await handler(request({ ...valid, user_id: 'abc' }))).status, 400);
  assert.equal((await handler(request({ ...valid, title: '' }))).status, 400);
  assert.equal((await handler(request({ ...valid, body: 'x'.repeat(501) }))).status, 400);
  assert.equal((await handler(request({ ...valid, data: [1, 2] }))).status, 400);
});

test('envia para tokens únicos em lotes de 100', async () => {
  const tokens = Array.from({ length: 250 }, (_, i) => `ExponentPushToken[${i}]`);
  const { deps, sent } = fakeDeps([...tokens, tokens[0]]);
  const res = await createNotifyHandler(deps)(request(valid));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: 250, failed: 0, removed: 0 });
  assert.deepEqual(sent.map((b) => b.length), [EXPO_BATCH_SIZE, EXPO_BATCH_SIZE, 50]);
  assert.deepEqual(sent[0][0].data, {});
});

test('remove tokens que o Expo diz não estarem mais registrados', async () => {
  const { deps, removed } = fakeDeps(['vivo', 'morto', 'falhou'], {
    sendPush: async () => [
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ],
  });
  const res = await createNotifyHandler(deps)(request(valid));
  assert.deepEqual(await res.json(), { sent: 1, failed: 2, removed: 1 });
  assert.deepEqual(removed, [['morto']]);
});

test('usuário sem dispositivo não chama o Expo', async () => {
  const { deps, sent } = fakeDeps([]);
  const res = await createNotifyHandler(deps)(request(valid));
  assert.deepEqual(await res.json(), { sent: 0, failed: 0, removed: 0 });
  assert.equal(sent.length, 0);
});

test('comparação de segredo', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});
