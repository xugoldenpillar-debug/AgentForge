import type { DisplayLanguage } from '@/shared/i18n/types';

export function localeFor(language: DisplayLanguage): string {
  return language === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function formatNumber(value: number, language: DisplayLanguage): string {
  return new Intl.NumberFormat(localeFor(language)).format(value);
}

export function formatPercent(value: number, language: DisplayLanguage): string {
  return new Intl.NumberFormat(localeFor(language), { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

export function formatDate(value: string | Date, language: DisplayLanguage): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(localeFor(language), { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

export function formatDuration(milliseconds: number, language: DisplayLanguage): string {
  if (milliseconds < 1000) return `${formatNumber(milliseconds, language)} ${language === 'zh-CN' ? '毫秒' : 'ms'}`;
  return `${formatNumber(Number((milliseconds / 1000).toFixed(2)), language)} ${language === 'zh-CN' ? '秒' : 's'}`;
}


export function formatMoney(value: number | null | undefined, language: DisplayLanguage): string {
  if (value == null) return language === 'zh-CN' ? '未知' : 'unknown';
  const fractionDigits = value === 0 ? 2 : value < 0.01 ? 5 : 3;
  return new Intl.NumberFormat(localeFor(language), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}
