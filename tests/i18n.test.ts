import assert from 'node:assert/strict';
import test from 'node:test';
import { en, interpolate, translateMessage, zhCN } from '../src/shared/i18n/messages.ts';
import {
  LOCALE_STORAGE_KEY,
  browserBootstrapScript,
  getInitialLanguage,
  isDisplayLanguage,
  languageFromBrowser,
  persistLanguage,
  readStoredLanguage,
  resolveLanguage,
  syncDocumentLanguage,
} from '../src/shared/i18n/locale.ts';
import type { DisplayLanguage } from '../src/shared/i18n/types.ts';
import {
  formatDate,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
} from '../src/lib/i18n/format.ts';

test('recognizes only supported display languages', () => {
  assert.equal(isDisplayLanguage('en'), true);
  assert.equal(isDisplayLanguage('zh-CN'), true);
  assert.equal(isDisplayLanguage('zh'), false);
  assert.equal(isDisplayLanguage('fr'), false);
  assert.equal(isDisplayLanguage(null), false);
});

test('maps Chinese browser languages to Simplified Chinese', () => {
  assert.equal(languageFromBrowser('zh'), 'zh-CN');
  assert.equal(languageFromBrowser('zh-CN'), 'zh-CN');
  assert.equal(languageFromBrowser('ZH-Hans'), 'zh-CN');
  assert.equal(languageFromBrowser('zh-TW'), 'zh-CN');
  assert.equal(languageFromBrowser('en-US'), 'en');
  assert.equal(languageFromBrowser(undefined), 'en');
});

test('prefers a valid local preference over the browser language', () => {
  const stored = { getItem: (key: string) => key === LOCALE_STORAGE_KEY ? 'zh-CN' : null };
  assert.equal(getInitialLanguage('en-US', stored), 'zh-CN');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(resolveLanguage('unsupported', 'zh-CN'), 'zh-CN');
  assert.equal(resolveLanguage(null, 'en-US'), 'en');
});

test('falls back safely when local storage is invalid or unavailable', () => {
  const invalid = { getItem: () => 'fr' };
  const throwing = { getItem: () => { throw new Error('storage blocked'); } };
  assert.equal(readStoredLanguage(invalid), null);
  assert.equal(getInitialLanguage('zh-CN', invalid), 'zh-CN');
  assert.equal(readStoredLanguage(throwing), null);
  assert.equal(getInitialLanguage('en-US', throwing), 'en');

  const writes: string[] = [];
  persistLanguage('zh-CN', { setItem: (key, value) => writes.push(`${key}=${value}`) });
  assert.deepEqual(writes, [`${LOCALE_STORAGE_KEY}=zh-CN`]);
  assert.doesNotThrow(() => persistLanguage('en', { setItem: () => { throw new Error('storage blocked'); } }));
});

test('interpolates named parameters and preserves placeholders when not in test mode', () => {
  assert.equal(interpolate('Build {id} by {name}.', { id: 42, name: 'Ada' }), 'Build 42 by Ada.');
  const previous = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  assert.equal(interpolate('Missing {value}.', {}), 'Missing {value}.');
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
});

test('fails fast for missing interpolation parameters in test mode', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  assert.throws(() => interpolate('Missing {value}.', {}), /Missing interpolation parameter: value/);
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
});

test('keeps English and Simplified Chinese message contracts aligned', () => {
  assert.deepEqual(Object.keys(zhCN).sort(), Object.keys(en).sort());
  assert.equal(translateMessage('en', 'builder.savedVersion', { revision: 3 }), 'Saved immutable version 3.');
  assert.equal(translateMessage('zh-CN', 'builder.savedVersion', { revision: 3 }), '已保存不可变版本 3。');
  assert.notEqual(translateMessage('zh-CN', 'navigation.arena'), translateMessage('en', 'navigation.arena'));
});

test('generates a pre-hydration locale bootstrap script', () => {
  const script = browserBootstrapScript();
  assert.match(script, new RegExp(LOCALE_STORAGE_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(script, /document\.documentElement\.lang/);
  assert.match(script, /dataset\.displayLanguage/);
  assert.match(script, /navigator\.language/);
  assert.match(script, /zh-CN/);
});

test('synchronizes the document language and data attribute', () => {
  const documentElement = { lang: 'en', dataset: {} as Record<string, string> };
  const documentLike = { documentElement } as unknown as Pick<Document, 'documentElement'>;
  syncDocumentLanguage('zh-CN', documentLike);
  assert.equal(documentElement.lang, 'zh-CN');
  assert.equal(documentElement.dataset.displayLanguage, 'zh-CN');
});

test('formats values according to the selected display language', () => {
  const date = '2026-01-15T12:00:00.000Z';
  assert.equal(formatNumber(1234567.89, 'en'), '1,234,567.89');
  assert.equal(formatNumber(1234567.89, 'zh-CN'), '1,234,567.89');
  assert.equal(formatPercent(0.875, 'en'), '87.5%');
  assert.equal(formatPercent(0.875, 'zh-CN'), '87.5%');
  assert.equal(formatDate(date, 'en'), 'Jan 15, 2026');
  assert.equal(formatDate(date, 'zh-CN'), '2026年1月15日');
  assert.equal(formatDuration(250, 'en'), '250 ms');
  assert.equal(formatDuration(1250, 'zh-CN'), '1.25 秒');
  assert.equal(formatMoney(0.00123, 'en'), '$0.00123');
  assert.equal(formatMoney(null, 'zh-CN'), '未知');
});
