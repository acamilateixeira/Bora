import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESENCE_STALE_MS, resolveDriverPresence } from '../../src/lib/driverPresence.ts';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

test('motorista com sinal recente mantém o status informado', () => {
  const r = resolveDriverPresence({ status: 'busy', statusUpdatedAt: ago(60_000) });
  assert.equal(r.effective, 'busy');
  assert.equal(r.stale, false);
});

test('sem sinal há mais que o limite, aparece offline', () => {
  const r = resolveDriverPresence({ status: 'online', statusUpdatedAt: ago(PRESENCE_STALE_MS + 1_000) });
  assert.equal(r.effective, 'offline');
  assert.equal(r.stale, true);
});

test('localização recente conta como sinal mesmo com status antigo', () => {
  const r = resolveDriverPresence({
    status: 'online',
    statusUpdatedAt: ago(PRESENCE_STALE_MS * 3),
    locationUpdatedAt: ago(30_000),
  });
  assert.equal(r.effective, 'online');
});

test('sem nenhuma data, ou com data inválida, é offline', () => {
  assert.equal(resolveDriverPresence({ status: 'online' }).effective, 'offline');
  assert.equal(resolveDriverPresence({ status: 'online', statusUpdatedAt: 'ontem' }).effective, 'offline');
});

test('aceita timestamp numérico', () => {
  const r = resolveDriverPresence({ status: 'online', locationUpdatedAt: Date.now() });
  assert.equal(r.effective, 'online');
});
