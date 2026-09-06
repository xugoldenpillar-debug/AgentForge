import { DEFAULT_LANGUAGE, LOCALE_STORAGE_KEY, type DisplayLanguage, SUPPORTED_LANGUAGES } from './types.ts';

export function isDisplayLanguage(value: unknown): value is DisplayLanguage {
  return value === 'en' || value === 'zh-CN';
}

export function languageFromBrowser(value: string | undefined | null): DisplayLanguage {
  if (typeof value === 'string' && /^zh(?:-|$)/i.test(value)) return 'zh-CN';
  return DEFAULT_LANGUAGE;
}

export function resolveLanguage(stored: unknown, browserLanguage?: string | null): DisplayLanguage {
  return isDisplayLanguage(stored) ? stored : languageFromBrowser(browserLanguage);
}

export function readStoredLanguage(storage?: Pick<Storage, 'getItem'>): DisplayLanguage | null {
  try {
    const stored = storage?.getItem(LOCALE_STORAGE_KEY);
    return isDisplayLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getInitialLanguage(browserLanguage?: string | null, storage?: Pick<Storage, 'getItem'>): DisplayLanguage {
  return resolveLanguage(readStoredLanguage(storage), browserLanguage);
}

export function persistLanguage(language: DisplayLanguage, storage?: Pick<Storage, 'setItem'>): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, language);
  } catch {
    // Private browsing and blocked storage should not prevent the UI from switching.
  }
}

export function syncDocumentLanguage(language: DisplayLanguage, document?: Pick<Document, 'documentElement'>): void {
  if (!document) return;
  document.documentElement.lang = language;
  document.documentElement.dataset.displayLanguage = language;
}

export function browserBootstrapScript(): string {
  const key = JSON.stringify(LOCALE_STORAGE_KEY);
  return `(()=>{try{const k=${key};const s=localStorage.getItem(k);const l=s==='zh-CN'||s==='en'?s:(/^zh(?:-|$)/i.test(navigator.language||'')?'zh-CN':'en');document.documentElement.lang=l;document.documentElement.dataset.displayLanguage=l}catch(_){document.documentElement.lang='en';document.documentElement.dataset.displayLanguage='en'}})();`;
}

export { DEFAULT_LANGUAGE, LOCALE_STORAGE_KEY, SUPPORTED_LANGUAGES };
