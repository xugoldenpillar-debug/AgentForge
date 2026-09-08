'use client';

import { useEffect, useRef, useState } from 'react';
import { FileUp, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { localizeError } from '@/components/common';
import { Button } from '@/components/ui/button';
import { listCreationSkills, uploadCreationSkill } from '@/lib/client-api';
import { parseCreationSkillFile } from '@/lib/creation-skill-file';
import { useLocale } from '@/lib/i18n';
import type { AgentBuildSkillRef } from '@/shared/agent-build-contract';
import { CREATION_SKILL_LIMITS, type CreationSkillView } from '@/shared/creation-skill';
import styles from './agent-builder.module.css';

export function AgentSkillPicker({ value, onChange, disabled, onBusyChange }: {
  value: readonly AgentBuildSkillRef[];
  onChange: (refs: readonly AgentBuildSkillRef[]) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useLocale();
  const [skills, setSkills] = useState<CreationSkillView[]>([]);
  const [pending, setPending] = useState<{ fileName: string; content: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const uploadLock = useRef(false);
  const selection = useRef(value);
  selection.current = value;

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setError('');
    setLoading(true);
    void listCreationSkills(controller.signal).then((rows) => {
      if (!controller.signal.aborted) setSkills(rows);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(localizeError(reason, latest.current));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const latest = useRef(t);
  latest.current = t;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);

  const choose = (skill: CreationSkillView) => {
    const selected = selection.current;
    const exists = selected.some((ref) => ref.versionId === skill.ref.versionId);
    const next = selected.filter((ref) => ref.componentId !== skill.ref.componentId);
    if (!exists) next.push(skill.ref);
    if (next.length > CREATION_SKILL_LIMITS.maxSkills) { setError(t('builderPlus.skillLimit')); return; }
    onChange(next);
  };

  const pick = async (file: File | undefined) => {
    if (!file || disabled || uploadLock.current) return;
    uploadLock.current = true;
    request.current?.abort();
    setLoading(false);
    setError('');
    setPending(null);
    setBusy(true);
    onBusyChange(true);
    try {
      if (file.size > CREATION_SKILL_LIMITS.maxFileBytes) throw new Error(t('builderPlus.skillFileLimit'));
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const parsed = parseCreationSkillFile(file.name, content);
      if (mounted.current) setPending({ fileName: file.name, content, name: parsed.name });
    } catch (reason) {
      if (mounted.current) setError(localizeError(reason, t));
    } finally {
      uploadLock.current = false;
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  };

  const upload = async () => {
    if (!pending || disabled || uploadLock.current) return;
    if (selection.current.length >= CREATION_SKILL_LIMITS.maxSkills) { setError(t('builderPlus.skillLimit')); return; }
    uploadLock.current = true;
    request.current?.abort();
    setLoading(false);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const skill = await uploadCreationSkill(pending.fileName, pending.content, controller.signal);
      if (controller.signal.aborted) return;
      setSkills((rows) => [skill, ...rows.filter((row) => row.ref.versionId !== skill.ref.versionId)]);
      onChange([...selection.current.filter((ref) => ref.componentId !== skill.ref.componentId), skill.ref]);
      setPending(null);
    } catch (reason) {
      if (!controller.signal.aborted) setError(localizeError(reason, t));
    } finally {
      uploadLock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  return <section className={styles.skillPicker} aria-labelledby="skill-picker-title">
    <div className={styles.buttonRow}><h3 id="skill-picker-title">{t('builderPlus.skills')}</h3><Button type="button" variant="ghost" size="sm" disabled={busy || loading || disabled} onClick={() => setRefresh((n) => n + 1)} aria-label={t('builderPlus.refreshSkills')}><RefreshCw size={14} /></Button></div>
    <p className={styles.helpText}>{t('builderPlus.skillHelp')}</p>
    {error && <div className={`${styles.banner} ${styles.errorBanner}`} role="alert">{error}</div>}
    <fieldset disabled={disabled || busy} className={styles.skillFields}>
      <label className={styles.uploadArea} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
        event.preventDefault();
        if (!busy) void pick(event.dataTransfer.files[0]);
      }}><FileUp size={18} /><span>{t('builderPlus.uploadSkill')}</span><input aria-label={t('builderPlus.uploadSkill')} type="file" accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ''; void pick(file);
      }} /></label>
      {pending && <div className={styles.skillPreview}><strong>{pending.name}</strong><pre>{pending.content.slice(0, 4000)}</pre><div className={styles.buttonRow}><Button type="button" onClick={upload}>{t('builderPlus.importSkill')}</Button><Button type="button" variant="ghost" onClick={() => setPending(null)}>{t('builderPlus.discardFile')}</Button></div></div>}
      <label className={styles.skillSearch}><span>{t('builderPlus.searchSkills')}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className={styles.skillList}>
        {skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(search.toLowerCase())).map((skill) => <article key={skill.ref.versionId} className={styles.skillOption}>
          <label><input type="checkbox" checked={value.some((ref) => ref.versionId === skill.ref.versionId)} onChange={() => choose(skill)} /><span><strong>{skill.name}</strong><small>v{skill.versionNumber} / {Math.ceil(skill.instructionBytes / 1024)} KiB</small></span></label>
          <details><summary>{t('builderPlus.previewSkill')}</summary><p>{skill.description}</p><pre>{skill.preview}</pre><code>{skill.ref.contentDigest}</code></details>
        </article>)}
      </div>
      {loading && <p className={styles.helpText} role="status">{t('builderPlus.loadingSkills')}</p>}
      {!loading && !skills.length && !error && <p className={styles.helpText}>{t('builderPlus.skillsEmpty')}</p>}
      <div className={styles.buttonRow}>{value.map((ref) => <Button key={ref.versionId} type="button" size="sm" variant="outline" onClick={() => onChange(value.filter((item) => item.versionId !== ref.versionId))} aria-label={`${t('builderPlus.removeSkill')}: ${skills.find((skill) => skill.ref.versionId === ref.versionId)?.name ?? ref.componentId}`}><X size={12} />{skills.find((skill) => skill.ref.versionId === ref.versionId)?.name ?? ref.componentId}</Button>)}</div>
    </fieldset>
    <p className={styles.helpText} role="status">{busy ? <><LoaderCircle size={14} className={styles.spin} /> {t('builderPlus.importingSkill')}</> : t('builderPlus.skillsSelected', { count: value.length })}</p>
  </section>;
}
