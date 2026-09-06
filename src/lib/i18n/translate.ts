'use client';
import { messages, translateMessage } from '@/shared/i18n/messages';
import type { DisplayLanguage, MessageKey, MessageParams } from '@/shared/i18n/types';

export function translate(language: DisplayLanguage, key: MessageKey, params?: MessageParams): string {
  return translateMessage(language, key, params);
}

export function hasTranslation(language: DisplayLanguage, key: MessageKey): boolean {
  return Boolean(messages[language]?.[key]);
}
