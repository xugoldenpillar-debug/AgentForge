'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, consumePiSelfTest, post } from '@/lib/client-api';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Icon, localizeError, useSession, useToast } from '@/components/common';
import { useLocale } from '@/lib/i18n';

type PiStatus = {
  invited: boolean;
  applied: boolean;
  canRun: boolean;
  reason: 'ok' | 'not_invited' | 'flag_off' | 'node_engine';
};

type ProvidersResponse = {
  demo?: boolean;
  credentials?: Array<{ id: string; name: string; modelId: string }>;
};

export function PiSelfTestEntry() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" type="button" onClick={() => setOpen(true)}>
        <Icon name="Sparkles" size={14} />{t('pi.entry')}
      </Button>
      {open ? <PiSelfTestPanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PiSelfTestPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const { user } = useSession();
  const [status, setStatus] = useState<PiStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState('What is 2+3?');
  const [credentialId, setCredentialId] = useState('demo');
  const [consent, setConsent] = useState(false);
  const [output, setOutput] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      try {
        const next = await api<PiStatus>('pi-self-test');
        const list = await api<ProvidersResponse>('providers');
        if (!active) return;
        setStatus(next);
        setProviders(list);
        if (list.demo) setCredentialId('demo');
        else if (list.credentials?.[0]) setCredentialId(list.credentials[0].id);
      } catch (reason) {
        if (active) setError(localizeError(reason, t));
      }
    })();
    return () => { active = false; };
  }, [user, t]);

  useEffect(() => () => controller.current?.abort(), []);

  async function apply() {
    setBusy(true);
    setError('');
    try {
      const next = await post<PiStatus>('pi-self-test', { intent: 'apply' });
      setStatus(next);
      toast(t('pi.applied'));
    } catch (reason) {
      setError(localizeError(reason, t));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError('');
    setOutput('');
    setEvents([]);
    controller.current = new AbortController();
    try {
      await consumePiSelfTest(
        { intent: 'run', prompt, credentialId, consent },
        (event) => {
          if (typeof event.type === 'string') {
            const type = event.type;
            setEvents((rows) => [...rows.slice(-12), type]);
          }
          if (event.type === 'completed' && typeof event.output === 'string') setOutput(event.output);
        },
        controller.current.signal
      );
      toast(t('pi.notCompetitive'));
    } catch (reason) {
      setError(reason instanceof Error && reason.name === 'AbortError' ? t('builder.runCancelled') : localizeError(reason, t));
    } finally {
      setBusy(false);
    }
  }

  const live = credentialId !== 'demo';

  return (
    <div className="pi-overlay" role="presentation" onClick={onClose}>
      <div className="pi-panel card card-pad" role="dialog" aria-labelledby="pi-self-test-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <div>
            <div className="eyebrow">PI / OPTIONAL</div>
            <h3 id="pi-self-test-title">{t('pi.title')}</h3>
          </div>
          <Button variant="ghost" size="icon" type="button" aria-label={t('pi.close')} onClick={onClose}><Icon name="X" /></Button>
        </div>
        <p className="small muted">{t('pi.subtitle')}</p>
        <p className="small dim mt-1">{t('pi.calculatorOnly')}</p>
        {error ? <div className="mt-2"><ErrorNotice message={error} /></div> : null}

        {!user ? (
          <div className="callout warning mt-3">
            <Icon name="Lock" size={13} />
            <div>
              <p>{t('pi.needSignIn')}</p>
              <Button className="mt-2" type="button" onClick={() => router.push('/login?next=/builder')}>{t('auth.signIn')}</Button>
            </div>
          </div>
        ) : !status?.invited ? (
          <div className="callout warning mt-3">
            <Icon name="Lock" size={13} />
            <div>
              <p>{status?.applied ? t('pi.appliedWait') : t('pi.needApply')}</p>
              {!status?.applied ? (
                <Button className="mt-2" type="button" disabled={busy} onClick={() => void apply()}>
                  {busy ? <span className="spinner" /> : null}{t('pi.apply')}
                </Button>
              ) : <span className="chip amber mt-2">{t('pi.applied')}</span>}
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <div className="callout small mb-2"><Icon name="Sparkles" size={13} />{t('pi.invited')}</div>
            {status.reason === 'flag_off' || status.reason === 'node_engine' ? (
              <div className="callout warning mb-2">{t('pi.flagOff')}</div>
            ) : null}
            <div className="field">
              <label className="label" htmlFor="pi-prompt">{t('pi.prompt')}</label>
              <textarea id="pi-prompt" rows={3} value={prompt} maxLength={2000} onChange={(event) => setPrompt(event.target.value)} placeholder={t('pi.promptPlaceholder')} />
            </div>
            <div className="field">
              <label className="label" htmlFor="pi-provider">{t('pi.provider')}</label>
              <select id="pi-provider" value={credentialId} onChange={(event) => setCredentialId(event.target.value)}>
                {providers?.demo ? <option value="demo">{t('pi.demoProvider')}</option> : null}
                {(providers?.credentials ?? []).map((credential) => (
                  <option key={credential.id} value={credential.id}>{credential.name} / {credential.modelId}</option>
                ))}
              </select>
            </div>
            {live ? (
              <label className="callout small mb-2 flex items-center gap-2">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                {t('pi.consent')}
              </label>
            ) : null}
            <div className="flex gap-2">
              {busy ? (
                <Button variant="outline" type="button" onClick={() => controller.current?.abort()}><Icon name="X" />{t('builder.cancel')}</Button>
              ) : (
                <Button type="button" disabled={!status.canRun} onClick={() => void run()}>
                  <Icon name="Play" size={14} />{t('pi.run')}
                </Button>
              )}
              <Link href="/providers" className="button ghost small">{t('builder.manageCredentials')}</Link>
            </div>
            {busy ? <p className="small dim mt-2"><span className="spinner" /> {t('pi.running')}</p> : null}
            {events.length ? <p className="small dim mt-2 mono">{events.join(' → ')}</p> : null}
            {output ? (
              <div className="mt-2">
                <div className="eyebrow">{t('pi.output')}</div>
                <pre>{output}</pre>
                <p className="small dim mt-1">{t('pi.notCompetitive')}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
