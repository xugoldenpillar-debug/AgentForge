'use client';

import { useState } from 'react';
import { useLocale } from '@/lib/i18n';
import { PROVIDER_PROTOCOLS, PROVIDER_PROTOCOL_BASE_URLS, type ProviderProtocol } from '@/shared/provider-protocol';

export function ProviderProtocolFields() {
  const { t } = useLocale();
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai-chat');
  const [baseUrl, setBaseUrl] = useState<string>(PROVIDER_PROTOCOL_BASE_URLS['openai-chat']);
  return <>
    <div className="field">
      <label htmlFor="provider-protocol" className="label">{t('providers.protocol')}</label>
      <select id="provider-protocol" name="protocol" value={protocol} onChange={event => {
        const next = event.target.value as ProviderProtocol;
        setProtocol(next);
        // Preserve an explicitly entered gateway; only replace an official preset.
        if (Object.values(PROVIDER_PROTOCOL_BASE_URLS).includes(baseUrl)) {
          setBaseUrl(PROVIDER_PROTOCOL_BASE_URLS[next]);
        }
      }}>
        {PROVIDER_PROTOCOLS.map(value => <option key={value} value={value}>{t(`providers.protocol.${value}`)}</option>)}
      </select>
      <small>{t('providers.protocolHelp')}</small>
    </div>
    <div className="field">
      <label htmlFor="provider-url" className="label">{t('providers.baseUrl')}</label>
      <input id="provider-url" name="baseUrl" type="url" required maxLength={300}
        value={baseUrl} onChange={event => setBaseUrl(event.target.value)} className="mono-input" />
      <small>{t('providers.protocolUrlHelp')}</small>
    </div>
  </>;
}

export function ProviderProtocolBadge({ protocol = 'openai-chat' }: { protocol?: ProviderProtocol }) {
  const { t } = useLocale();
  return <span className="chip subtle">{t(`providers.protocol.${protocol}`)}</span>;
}
