'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import styles from './official-api-gallery.module.css';

const SEASON_ID = 'season-2026-launch';
const COMPARATOR_KEY = 'artifact-arena:showcase:v1';
const POLICY_VERSION = 'showcase-pairwise-v1';

type ChallengeVersion = { id: string; title: string; titleEn: string; versionNumber: number };
type Challenge = { id: string; slug: string; versions: ChallengeVersion[] };
type SkillRef = { componentId: string; versionId: string; contentDigest: string; name: string; description: string };
type Provenance = {
  challenge: { challengeVersionId: string; title: string; prompt: string };
  model: { modelId: string; providerClass: 'official' | 'custom'; providerId: string; providerHost: string; protocol: string };
  runtime: { kind: 'pi'; adapterVersion: string; policyVersion: string; systemPromptVersion: string };
  skills: SkillRef[];
  prompts: { agentInstructions: string; challengeInstructions: string };
  capturedAt: string;
};
type Publication = {
  publicationId: string;
  title: string;
  description: string;
  entryPath: string;
  createdAt: string;
};
type Row = {
  entryId: string;
  publication: Publication;
  comparisons: number;
  points: number;
  score: number;
  validVoters: number;
  qualified: boolean;
  provenance: Provenance | null;
};
type OfficialSection = { key: string; providerId: string; modelId: string; rows: Row[] };
type Leaderboard = {
  sample: { validVotes: number; independentVoters: number; qualified: boolean };
  officialSections: OfficialSection[];
};
type PreviewProjection = {
  plan: { format: string; renderer: string };
  body: { kind: 'text'; content: string } | { kind: 'binary'; base64: string };
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Request failed (${response.status})`);
  return body;
}

function WorkCard({ row }: { row: Row }) {
  const [preview, setPreview] = useState<PreviewProjection | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const provenance = row.provenance;

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    const url = `/api/arena/showcase/publications/${encodeURIComponent(row.publication.publicationId)}/preview?path=${encodeURIComponent(row.publication.entryPath)}`;
    void readJson<PreviewProjection>(url).then((value) => {
      if (!cancelled) setPreview(value);
    }).catch((error: unknown) => {
      if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'Preview unavailable');
    });
    return () => { cancelled = true; };
  }, [row.publication.entryPath, row.publication.publicationId]);

  const html = preview?.body.kind === 'text' ? preview.body.content : null;
  return (
    <article className={styles.card}>
      {html ? (
        <iframe
          className={styles.preview}
          title={`${row.publication.title} preview`}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={html}
        />
      ) : (
        <div className={styles.previewFallback}>{previewError || 'Loading sealed HTML preview…'}</div>
      )}
      <div className={styles.cardBody}>
        <div>
          <h3 className={styles.cardTitle}>{row.publication.title}</h3>
          {row.publication.description ? <p className={styles.description}>{row.publication.description}</p> : null}
        </div>
        <div className={styles.metrics}>
          <span className={styles.pill}>score {row.score.toFixed(3)}</span>
          <span className={styles.pill}>{row.comparisons} comparisons</span>
          <span className={styles.pill}>{row.validVoters} voters</span>
          {provenance ? <span className={styles.pill}>{provenance.runtime.adapterVersion}</span> : null}
        </div>
        {provenance?.skills.length ? (
          <div className={styles.skills} aria-label="Loaded skills">
            {provenance.skills.map((skill) => <span className={styles.skill} key={skill.versionId}>Skill · {skill.name}</span>)}
          </div>
        ) : <div className={styles.skills}><span className={styles.skill}>No Skill</span></div>}
        {provenance ? (
          <details className={styles.details}>
            <summary>Model / Skill / Prompt provenance</summary>
            <div className={styles.metrics} style={{ marginTop: 8 }}>
              <span className={styles.pill}>{provenance.model.providerId}</span>
              <span className={styles.pill}>{provenance.model.modelId}</span>
              <span className={styles.pill}>{provenance.model.protocol}</span>
              <span className={styles.pill}>{provenance.runtime.policyVersion}</span>
            </div>
            <p className={styles.description}>Agent instructions</p>
            <pre className={styles.prompt}>{provenance.prompts.agentInstructions}</pre>
            <p className={styles.description}>Challenge prompt</p>
            <pre className={styles.prompt}>{provenance.prompts.challengeInstructions}</pre>
          </details>
        ) : null}
        <div className={styles.timestamp}>{provenance ? `Captured ${new Date(provenance.capturedAt).toLocaleString()}` : 'Legacy run: provenance was not captured.'}</div>
      </div>
    </article>
  );
}

export function OfficialApiGalleryPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const versions = useMemo(() => challenges.flatMap((challenge) => challenge.versions.map((version) => ({
    ...version,
    challengeSlug: challenge.slug,
  }))), [challenges]);

  useEffect(() => {
    let cancelled = false;
    void readJson<Challenge[]>('/api/arena/animation-challenges').then((value) => {
      if (cancelled) return;
      setChallenges(value);
      const first = value.flatMap((challenge) => challenge.versions)[0];
      if (first) setSelectedVersionId(first.id);
      else setLoading(false);
    }).catch((cause: unknown) => {
      if (!cancelled) { setError(cause instanceof Error ? cause.message : 'Failed to load challenges'); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedVersionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const roundId = `${selectedVersionId}:${SEASON_ID}:byok`;
    const query = new URLSearchParams({ roundId, comparatorKey: COMPARATOR_KEY, policyVersion: POLICY_VERSION });
    void readJson<Leaderboard>(`/api/arena/showcase/creation-leaderboard?${query.toString()}`).then((value) => {
      if (!cancelled) { setLeaderboard(value); setLoading(false); }
    }).catch((cause: unknown) => {
      if (!cancelled) { setError(cause instanceof Error ? cause.message : 'Failed to load leaderboard'); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [selectedVersionId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.eyebrow}>Artifact Arena · Official API Gallery</div>
        <h1 className={styles.title}>同一个官方 API，看看大家做出了什么</h1>
        <p className={styles.lede}>只展示由服务器按官方域名 + API 协议验证过的结果。每个作品保留当时的模型、加载 Skill、Agent Prompt、题目 Prompt 和 Pi 运行时版本；评分仍来自同一套社区两两投票榜。</p>
        <div className={styles.controls}>
          <label className={styles.label}>题目版本
            <select className={styles.select} value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.title} · v{version.versionNumber}</option>)}
            </select>
          </label>
          <Link className={styles.link} href="/agent-builder">去 Agent Builder 参与 →</Link>
        </div>
      </header>

      {loading ? <div className={styles.status}>Loading official API results…</div> : null}
      {error ? <div className={styles.status}>{error}</div> : null}
      {!loading && !error && leaderboard?.officialSections.length === 0 ? (
        <div className={styles.status}>这个题目还没有带新 provenance 的官方 API 公布作品。老作品不会被猜测归类。</div>
      ) : null}

      <div className={styles.sections}>
        {leaderboard?.officialSections.map((section) => (
          <section className={styles.section} key={section.key}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{section.providerId} · {section.modelId}</h2>
              <div className={styles.sectionMeta}>{section.rows.length} works · {leaderboard.sample.validVotes} valid votes · {leaderboard.sample.independentVoters} voters</div>
            </div>
            <div className={styles.grid}>
              {section.rows.map((row) => <WorkCard row={row} key={row.entryId} />)}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
