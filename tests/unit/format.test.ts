import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCpfMask,
  formatLastSeen,
  formatPhoneMask,
  onlyDigits,
  requestStatusLabel,
} from '../../src/utils/format.ts';
import { buildDisplay, formatNominatimAddress, formatStateShort, normalizeLoose } from '../../src/utils/address.ts';

test('máscara de telefone acompanha a digitação', () => {
  assert.equal(formatPhoneMask('31'), '31');
  assert.equal(formatPhoneMask('3199'), '(31) 99');
  assert.equal(formatPhoneMask('3133334444'), '(31) 3333-4444');
  assert.equal(formatPhoneMask('31999998888'), '(31) 99999-8888');
  assert.equal(formatPhoneMask('(31) 99999-8888 ramal 2'), '(31) 99999-8888');
});

test('máscara de CPF limita a 11 dígitos', () => {
  assert.equal(formatCpfMask('123'), '123');
  assert.equal(formatCpfMask('1234567'), '123.456.7');
  assert.equal(formatCpfMask('123456789012'), '123.456.789-01');
  assert.equal(onlyDigits('a1b2'), '12');
});

test('última atividade em minutos dentro da última hora', () => {
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal(formatLastSeen(tenMinAgo), 'há 10 min');
  assert.equal(formatLastSeen('não é data'), '');
  assert.equal(formatLastSeen(null), '');
});

test('status da corrida em português, com fallback para o valor cru', () => {
  assert.equal(requestStatusLabel('in_progress'), 'Em andamento');
  assert.equal(requestStatusLabel('novo_status'), 'novo_status');
});

test('UF a partir do nome do estado, com ou sem acento', () => {
  assert.equal(formatStateShort('Minas Gerais'), 'MG');
  assert.equal(formatStateShort('São Paulo'), 'SP');
  assert.equal(formatStateShort('sao paulo'), 'SP');
  assert.equal(formatStateShort(undefined, 'rj'), 'RJ');
  assert.equal(formatStateShort('Estado Desconhecido'), 'Estado Desconhecido');
});

test('endereço do Nominatim vira uma linha legível', () => {
  const line = formatNominatimAddress({
    road: 'Rua da Bahia',
    house_number: '1148',
    suburb: 'Centro',
    city: 'Belo Horizonte',
    state: 'Minas Gerais',
    postcode: '30160-011',
  });
  assert.equal(line, 'Rua da Bahia, 1148 • Centro - Belo Horizonte - MG - 30160-011');
});

test('nome do lugar não se repete quando é igual à rua', () => {
  assert.equal(normalizeLoose('  Praça   da Liberdade '), 'praca da liberdade');
  assert.equal(buildDisplay('Rua da Bahia', 'Centro - BH', 'Rua da Bahia'), 'Centro - BH');
  assert.equal(buildDisplay('Escola Estadual', 'Centro - BH'), 'Escola Estadual — Centro - BH');
  assert.equal(buildDisplay('', 'Centro - BH'), 'Centro - BH');
});
