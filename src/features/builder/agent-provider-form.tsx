'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';
import { localizeError, useToast } from '@/components/common';
import { Button } from '@/components/ui/button';
import { addProvider, discoverProviderModels, type ProviderCredentialView } from '@/lib/client-api';
import { useLocale } from '@/lib/i18n';
import { PROVIDER_PROTOCOL_BASE_URLS, PROVIDER_PROTOCOLS, type ProviderProtocol } from '@/shared/provider-protocol';
import { normalizeProviderBaseUrl, type ProviderModelsResult } from '@/shared/provider-models';
import styles from './agent-builder.module.css';

export function AgentProviderForm({ disabled, allowedHosts, onSaved }: {
  disabled: boolean;
  allowedHosts: readonly string[];
  onSaved: (credential: ProviderCredentialView) => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai-chat');
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PROTOCOL_BASE_URLS['openai-chat']);
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [modelId, setModelId] = useState('');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<ProviderModelsResult | null>(null);
  const [busy, setBusy] = useState<'discover' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setResult(null);
    setSearch('');
    setError('');
    setBusy((current) => current === 'discover' ? null : current);
    return () => request.current?.abort();
  }, [baseUrl, protocol, apiKey]);

  const discover = async () => {
    if (disabled || saving.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy('discover');
    setError('');
    setResult(null);
    try {
      const next = await discoverProviderModels({ protocol, baseUrl: baseUrl.trim(), apiKey }, controller.signal);
      if (controller.signal.aborted) return;
      setResult(next);
      if (next.models.length === 1 && !modelId) setModelId(next.models[0].id);
    } catch (reason) {
      if (!controller.signal.aborted) setError(localizeError(reason, t));
    } finally {
      if (request.current === controller) setBusy(null);
    }
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || busy || saving.current) return;
    saving.current = true;
    setBusy('save');
    setError('');
    try {
      const saved = await addProvider({ protocol, baseUrl: baseUrl.trim(), apiKey, name: name.trim(), modelId: modelId.trim() });
      setApiKey('');
      setVisible(false);
      onSaved(saved);
      toast(t('artifactArena.credentialSaved'));
    } catch (reason) {
      setError(localizeError(reason, t));
    } finally {
      saving.current = false;
      setBusy(null);
    }
  };

  let host = '';
  let endpoint = '';
  try {
    const normalized = normalizeProviderBaseUrl(baseUrl, protocol);
    host = new URL(normalized).hostname;
    endpoint = `${normalized}/models`;
  } catch { /* Incomplete URLs are normal while typing; the submit boundary validates them. */ }
  const hostAllowed = allowedHosts.includes(host);
  const filtered = result?.models.filter((model) => `${model.id} ${model.name}`.toLowerCase().includes(search.toLowerCase())) ?? [];

  return <form onSubmit={save}>
    <fieldset className={styles.formGrid} disabled={disabled || busy === 'save'}>
      <label><span>{t('providers.protocol')}</span><select value={protocol} onChange={(event) => {
        const next = event.target.value as ProviderProtocol;
        setProtocol(next);
        setModelId('');
        if (Object.values(PROVIDER_PROTOCOL_BASE_URLS).includes(baseUrl)) setBaseUrl(PROVIDER_PROTOCOL_BASE_URLS[next]);
      }}>{PROVIDER_PROTOCOLS.map((value) => <option key={value} value={value}>{t(`providers.protocol.${value}`)}</option>)}</select></label>
      <label><span>{t('artifactArena.credentialName')}</span><input required minLength={1} maxLength={60} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" /></label>
      <label className={styles.fullField}><span>{t('artifactArena.baseUrl')}</span><input required type="url" maxLength={300} value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setModelId(''); }} aria-describedby="provider-url-help" /></label>
      <p id="provider-url-help" className={`${styles.fullField} ${styles.helpText}`}>{t('providers.protocolUrlHelp')}<br />{t('builderPlus.allowedHosts', { hosts: allowedHosts.join(', ') || t('builderPlus.none') })}</p>
      <label className={styles.fullField}><span>{t('artifactArena.apiKey')}</span><div className={styles.secretInput}><input required type={visible ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} minLength={16} maxLength={512} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={t('providers.keyPlaceholder')} /><Button type="button" variant="ghost" aria-label={t(visible ? 'builderPlus.hideKey' : 'builderPlus.showKey')} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</Button></div></label>
      <div className={`${styles.fullField} ${styles.buttonRow}`}><Button type="button" variant="outline" disabled={busy === 'discover' || !hostAllowed || apiKey.trim().length < 16} onClick={discover}>{busy === 'discover' ? <LoaderCircle size={14} className={styles.spin} /> : <RefreshCw size={14} />}{t(busy === 'discover' ? 'builderPlus.discovering' : 'builderPlus.discoverModels')}</Button><small className={styles.helpText}>{endpoint && `GET ${endpoint}`}</small></div>
      {host && !hostAllowed && <p className={`${styles.fullField} ${styles.helpText}`} role="status">{t('builderPlus.hostNotAllowed')}</p>}
      {error && <div className={`${styles.fullField} ${styles.banner} ${styles.errorBanner}`} role="alert">{error}<br />{t('builderPlus.manualModelHelp')}</div>}
      {result && <>
        <p className={`${styles.fullField} ${styles.helpText}`} role="status">{t(result.models.length ? 'builderPlus.modelsFound' : 'builderPlus.modelsEmpty', { count: result.models.length })}{result.truncated && ` ${t('builderPlus.modelsTruncated')}`}</p>
        {result.models.length > 0 && <>
          <label><span>{t('builderPlus.searchModels')}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label><span>{t('builderPlus.modelList')}</span><select value={filtered.some((model) => model.id === modelId) ? modelId : ''} onChange={(event) => setModelId(event.target.value)}><option value="">{t('builderPlus.chooseModel')}</option>{filtered.map((model) => <option key={model.id} value={model.id}>{model.id}{model.name !== model.id ? ` / ${model.name}` : ''}</option>)}</select></label>
        </>}
      </>}
      <label className={styles.fullField}><span>{t('artifactArena.modelId')}</span><input required maxLength={160} value={modelId} onChange={(event) => setModelId(event.target.value)} autoComplete="off" placeholder={t('providers.formModelPlaceholder')} /></label>
      <p className={`${styles.fullField} ${styles.helpText}`}>{t('builderPlus.manualModelHelp')}</p>
      <div className={styles.fullField}><Button type="submit" disabled={Boolean(busy) || !hostAllowed || !name.trim() || !modelId.trim()}>{busy === 'save' ? <LoaderCircle size={14} className={styles.spin} /> : <KeyRound size={14} />}{t(busy === 'save' ? 'artifactArena.savingCredential' : 'artifactArena.saveCredential')}</Button></div>
    </fieldset>
  </form>;
}
