'use client';
import { useLocale } from '@/lib/i18n';

export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useLocale();
  return (
    <main className="container page">
      <div className="eyebrow">{t('errors.recoverable')}</div>
      <h1>{t('errors.forgeSnag')}</h1>
      <p className="muted mt-3">{t('errors.retryHint')}</p>
      <button className="button primary mt-3" onClick={reset}>{t('common.tryAgain')}</button>
    </main>
  );
}
