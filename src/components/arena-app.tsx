'use client';
import { Suspense,useEffect,useState,useMemo,type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname,useRouter,useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { authClient } from '@/lib/auth-client';
import { api,post } from '@/lib/client-api';
import { money,number,percent,duration,cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar,ChallengeCard,Empty,ErrorNotice,Footer,GradeList,Icon,LanguageSwitcher,localizeError,LaneNote,LeaderTable,Loading,PageHeading,SectionHeading,SessionContext,ToastProvider,problemIcon,useData,useSession,useToast } from './common';
import { ProviderProtocolFields, ProviderProtocolBadge } from './provider-protocol-fields';
import { BuilderPage } from '@/features/builder/builder-page';
import { useLocale } from '@/lib/i18n';
import { localizeSystemContent, systemLabel } from '@/shared/i18n/system-content';
import { normalizeProviderBaseUrl, PROVIDER_FIELD_LIMITS, parseProviderProtocol, validateProviderFormValues } from '@/shared/provider-protocol';
import type { CatalogDetail, CatalogExample, CatalogParameter } from '@/shared/catalog-details';
const WorkflowPreview=dynamic(()=>import('@/features/builder/canvas').then(m=>m.WorkflowPreview),{ssr:false,loading:()=> <Loading/>});
function Header(){
 const {t}=useLocale();
 const path=usePathname(),{user}=useSession(),router=useRouter();
 const nav=[['/',t('navigation.arena')],['/challenges',t('navigation.challenges')],['/leaderboard',t('navigation.leaderboards')],['/workshop',t('navigation.workshop')]] as const;
 return <header className="site-header"><Link href="/" className="brand" aria-label={t('navigation.home')} data-no-locale><span className="brand-mark"><span>A</span></span><span>Agent<span className="accent">Forge</span></span><span className="chip subtle" style={{fontSize:8}}>{t('common.beta')}</span></Link><nav className="site-nav" aria-label={t('navigation.arena')}>{nav.map(([href,label])=><Link key={href} href={href} className={path===href||href!=='/'&&path.startsWith(href)?'active':''}>{label}</Link>)}</nav><div className="header-actions"><span className="season-pill"><span className="live-dot"/>{t('header.localSeason')}</span><LanguageSwitcher/>{user?<><Link href="/providers" className="button icon ghost" aria-label={t('navigation.providerSettings')}><Icon name="Settings"/></Link><Link href={`/profile/${user.id}`} className="flex items-center gap-2"><Avatar name={user.name}/><span className="small header-user-name">{user.name.split(' ')[0]}</span></Link><button className="button icon ghost" aria-label={t('navigation.signOut')} onClick={async()=>{await authClient.signOut();router.push('/');}}><Icon name="LogOut"/></button></>:<Link href="/login" className="button primary">{t('navigation.startBuilding')} <Icon name="ArrowUpRight"/></Link>}</div></header>;
}
function HeroLab() {
  const { t } = useLocale();
  return (
    <div className="hero-lab" aria-label={t('home.workflowIllustration')}>
      <div className="lab-titlebar">
        <span className="window-dot" /><span className="window-dot" /><span className="window-dot" />
        <span className="lab-name">quiet-extractor / workflow.ts</span>
        <span className="push-right accent">{t('home.workflowIllustration')}</span>
      </div>
      <div className="lab-stage">
        <div className="mini-link" />
        <div className="mini-node">
          <div className="mini-type">01 / {t('builder.prompt').toUpperCase()}</div>
          <div className="mini-name">{t('home.findSignal')}</div>
          <div className="mini-meta">{t('home.instructionsReady')}</div>
        </div>
        <div className="mini-node model">
          <div className="mini-type purple">02 / {t('home.engine')}</div>
          <div className="mini-name">BYOK</div>
          <div className="mini-meta purple">{t('home.reasonExtract')}</div>
        </div>
        <div className="mini-node">
          <div className="mini-type">03 / {t('home.output')}</div>
          <div className="mini-name">{t('home.structuredJson')}</div>
          <div className="mini-meta">{t('home.contractChecked')}</div>
        </div>
      </div>
      <div className="lab-terminal">
        <div className="terminal-line"><span><span className="accent">&#10003;</span> {t('home.workflowCompiled')}</span><span>{t('home.dagValid')}</span></div>
        <div className="terminal-line"><span><span className="accent">&#10003;</span> {t('home.publicTestSuite')}</span><span>{t('home.readyToRun')}</span></div>
        <div className="terminal-line"><span className="dim">$ forge your next move<span className="accent">_</span></span></div>
      </div>
      <div className="lab-score"><Icon name="Zap" /><span className="mono small">{t('home.nextHighScore').split('\n').map((line) => <span key={line}>{line}<br /></span>)}</span></div>
    </div>
  );
}
function Home() {
  const { t, language, formatNumber, formatPercent } = useLocale();
  const { data, error, loading, reload } = useData('overview');
  if (loading) return <div className="container"><Loading /></div>;
  if (error) return <div className="container page"><ErrorNotice message={error} retry={reload} /></div>;
  if (!data) return null;

  const boss = localizeSystemContent('problem', data.worldBoss, language);
  const stats = [
    [t('home.statsActiveChallenges'), data.stats.problems, 'Target'],
    [t('home.statsAgentBuilds'), data.stats.builds, 'Boxes'],
    [t('home.statsCompletedRuns'), data.stats.runs, 'Activity'],
    [t('home.statsBuilders'), data.stats.builders, 'Users'],
  ] as const;

  return (
    <main className="container">
      <section className="hero">
        <div>
          <div className="eyebrow"><span className="live-dot" />{t('home.eyebrow')}</div>
          <h1>{t('home.titleBuild')}<br /><span className="soft">{t('home.titleProblems')}</span></h1>
          <p className="description">{t('home.description')}</p>
          <div className="actions">
            <Link href="/challenges" className="button primary large">{t('navigation.arena')} <Icon name="ArrowRight" /></Link>
            <Link href="/workshop" className="button outline large"><Icon name="Boxes" /> {t('navigation.exploreWorkshop')}</Link>
          </div>
          <p className="sub-note">{t('home.heroNote')}</p>
        </div>
        <HeroLab />
      </section>

      <section className="stats-strip">
        {stats.map(([label, value, icon]) => <div className="stat" key={label}><div><strong>{formatNumber(value)}</strong><label>{label}</label></div><Icon name={icon} /></div>)}
      </section>

      <div className="home-main">
        <div>
          <SectionHeading title={t('home.allOfUs')} href={`/challenges/${boss.slug}`} link={t('home.bossBriefing')} />
          <div className="card boss-card">
            <div className="boss-visual"><Icon name="Orbit" /></div>
            <div className="flex gap-2"><span className="chip purple"><Icon name="Target" size={10} /> {t('home.worldBoss')}</span><span className="chip subtle">{t('home.coopChallenge')}</span></div>
            <h2>{t('home.bossTitle')}</h2>
            <p>{boss.title}. {t('home.bossDescription')}</p>
            <div className="flex justify-between small mb-2"><span className="muted">{t('common.communitySolveRate')} </span><span className="mono purple">{formatPercent(boss.stats.solveRate)}</span></div>
            <div className="boss-progress"><span style={{ width: `${boss.stats.solveRate * 100}%` }} /></div>
            <div className="boss-stats">
              <div><label>{t('common.currentBest')}</label><strong>{formatNumber(boss.stats.bestScore)} <span className="dim small">/ 1000</span></strong></div>
              <div><label>{t('common.builders')}</label><strong>{formatNumber(boss.stats.participants)}</strong></div>
              <div><label>{t('common.reward')}</label><strong className="purple">+{formatNumber(boss.reward)} REP</strong></div>
              <Link href={`/challenges/${boss.slug}`} className="button outline">{t('navigation.joinChallenge')} <Icon name="ArrowUpRight" /></Link>
            </div>
          </div>

          <SectionHeading title={t('challenges.title')} count={data.problems.length} href="/challenges" link={t('navigation.exploreChallenges')} />
          <div className="challenges-grid">{data.problems.filter((problem: any) => !problem.worldBoss).map((problem: any) => <ChallengeCard key={problem.id} problem={problem} />)}</div>
          <div className="callout mt-3"><Icon name="GitFork" />{t('home.remixCallout')}</div>
        </div>

        <aside>
          <div className="sidebar-section">
            <SectionHeading title={t('home.topBuilders')} href="/leaderboard" />
            <div className="builders-list">{data.topBuilders.map((user: any, index: number) => <Link className="builder-row" key={user.id} href={`/profile/${user.id}`}><span className="place">0{index + 1}</span><Avatar name={user.name} index={index} /><span className="name">{user.name}<div className="dim" style={{ fontSize: 9 }}>{t('home.viewProfile')}</div></span><span className="rep">{formatNumber(user.reputation)}<span className="dim"> {t('common.rp')}</span></span></Link>)}</div>
          </div>
          <div className="sidebar-section">
            <SectionHeading title={t('workshop.title')} href="/workshop" />
            {data.skills.map((skill: any) => { const localized = localizeSystemContent('skill', skill, language); return <Link href={`/workshop#${skill.id}`} className="skill-mini" key={skill.id}><div className="icon-box purple"><Icon name={skill.icon} /></div><div><div className="skill-name">{localized.name ?? skill.name}</div><p>{t('home.versionsEquipped', { count: formatNumber(skill.usageCount) })}</p></div><Icon name="ArrowUpRight" className="push-right dim" size={12} /></Link>; })}
          </div>
          <div className="sidebar-section">
            <SectionHeading title={t('failure.title')} />
            {data.failures.slice(0, 2).map((failure: any) => <Link href={`/challenges/${failure.problemId}`} className="failure-mini" style={{ display: 'block' }} key={failure.id}><span className="eyebrow purple"><Icon name="Crosshair" size={10} /> {t('home.failureDiscovered')}</span><p>{failure.reason}</p><footer>{failure.creator} <span className="push-right">&#8599;</span></footer></Link>)}
          </div>
        </aside>
      </div>
      <Footer />
    </main>
  );
}
function Challenges() {
  const { t, language } = useLocale();
  const { data, error, loading, reload } = useData<any[]>('problems');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All challenges');
  const filterLabels: Record<string, string> = {
    'All challenges': t('challenges.allChallenges'),
    Starter: systemLabel('difficulty', 'Starter', 'Starter', language),
    Intermediate: systemLabel('difficulty', 'Intermediate', 'Intermediate', language),
    Expert: systemLabel('difficulty', 'Expert', 'Expert', language),
    'World Boss': t('challenges.worldBoss'),
  };
  const problems = data?.filter((problem) =>
    (filter === 'All challenges' || (filter === 'World Boss' && problem.worldBoss) || problem.difficulty === filter)
    && `${problem.title} ${problem.description}`.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <main className="container page">
      <PageHeading eyebrow={t('challenges.eyebrow')} title={t('challenges.title')} description={t('challenges.description')} action={<Link href="/problems/new" className="button outline"><Icon name="Plus" /> {t('challenges.createProblem')}</Link>} />
      <div className="leaderboard-controls">
        <div className="tabs" style={{ border: 0, margin: 0, padding: 0 }}>
          {Object.entries(filterLabels).map(([value, label]) => <button key={value} className={cn('tab', filter === value && 'active')} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <div style={{ width: 230 }}>
          <input aria-label={t('challenges.search')} placeholder={t('challenges.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>
      {loading ? <Loading /> : error ? <ErrorNotice message={error} retry={reload} /> : problems.length ? <div className="challenges-grid">{problems.map((problem) => <ChallengeCard key={problem.id} problem={problem} />)}</div> : <Empty title={t('challenges.noMatch')} description={t('challenges.noMatchDescription')} />}
      <Footer />
    </main>
  );
}
function ChallengeDetail({ slug }: { slug: string }) {
  const { t, language, formatNumber, formatMoney, formatDuration } = useLocale();
  const { data: problem, error, loading, reload } = useData<any>(`problems/${slug}`);
  const [tab, setTab] = useState<'mission' | 'leaderboard' | 'failure'>('mission');

  if (loading) return <div className="container"><Loading /></div>;
  if (error || !problem) return <div className="container page"><ErrorNotice message={error || t('errors.challengeUnavailable')} retry={reload} /></div>;

  const display = localizeSystemContent('problem', problem, language);
  const tabs = [
    ['mission', t('challenge.missionBriefing'), 'BookOpen'],
    ['leaderboard', t('navigation.leaderboards'), 'Trophy'],
    ['failure', t('failure.title'), 'Crosshair'],
  ] as const;
  const categoryLabel = (category: string) => category === 'normal'
    ? t('challenge.standardInput')
    : category === 'security'
      ? t('challenge.injectionResistance')
      : t('challenge.boundaryCondition');
  const scoreWeights = [
    [t('challenge.scoringAccuracy'), '45%'],
    [t('challenge.scoringRobustness'), '20%'],
    [t('challenge.scoringSecurity'), '15%'],
    [t('challenge.scoringEfficiency'), '10%'],
    [t('challenge.scoringElegance'), '10%'],
  ];

  return (
    <main className="container page">
      <div className="breadcrumb"><Link href="/challenges">{t('navigation.challenges')}</Link><Icon name="ChevronRight" size={12} /><span>{display.title ?? problem.title}</span></div>
      <div className="page-heading">
        <div className="flex items-center gap-3"><div className={cn('icon-box large', problem.judge === 'secret' && 'purple')}><Icon name={problemIcon(problem)} /></div><div><div className="flex gap-2 mb-2"><span className="chip green">{t('challenges.active')}</span><span className="chip">{display.difficulty ?? problem.difficulty}</span>{problem.worldBoss && <span className="chip purple">{t('challenges.worldBoss')}</span>}</div><h1 style={{ fontSize: 38, margin: 0 }}>{display.title ?? problem.title}</h1></div></div>
        <Link className="button primary large" href={`/builder?problem=${problem.id}`}>{t('challenges.buildAgent')} <Icon name="ArrowRight" /></Link>
      </div>
      <div className="tabs">{tabs.map(([value, label, icon]) => <button className={cn('tab', tab === value && 'active')} key={value} onClick={() => setTab(value)}><Icon name={icon} />{label}</button>)}</div>
      {tab === 'leaderboard' ? <LeaderboardSection problemId={problem.id} /> : tab === 'failure' ? <FailureLab problem={problem} onSubmitted={reload} /> : <div className="detail-grid">
        <div className="stack">
          <div className="card card-pad mission"><div className="eyebrow">{t('challenge.missionBriefing')}</div><h3 className="mt-2">{t('challenge.description')}</h3><p>{display.mission ?? problem.mission}</p><div className="divider" /><h4>{t('challenge.winCondition')}</h4><p>{display.goal ?? problem.goal}</p><div className="flex wrap gap-1 mt-2">{problem.tags.map((tag: string) => <span key={tag} className="chip">{tag}</span>)}</div></div>
          <div className="card card-pad"><SectionHeading title={t('challenge.publicTestSuite')} count={problem.publicTests.length} /><p className="small muted mb-2">{t('challenge.examplesHint')}</p>{problem.publicTests.map((test: any, index: number) => <details className="test-card" key={test.id} open={index === 0}><summary><span className="mono dim">0{index + 1}</span><span>{categoryLabel(test.category)}</span><span className={cn('chip', test.category === 'security' ? 'purple' : 'subtle')}>{categoryLabel(test.category)}</span></summary><div className="test-body"><div><div className="eyebrow">{t('common.input')}</div><pre>{test.input}</pre></div><div><div className="eyebrow">{t('challenge.expectedContract')}</div><pre>{typeof test.expected === 'string' ? test.expected : JSON.stringify(test.expected, null, 2)}</pre></div></div></details>)}</div>
          <div className="card card-pad"><div className="flex items-center gap-2 mb-2"><Icon name="Lock" className="purple" /><h3>{t('challenge.hiddenCasesTitle')}</h3></div><p className="small muted mb-3">{t('challenge.hiddenCasesDescription')}</p><div className="hidden-tests">{Object.entries(problem.hiddenCounts).map(([key, value]) => <div className="hidden-test-counter" key={key}><strong>{formatNumber(Number(value)).padStart(2, '0')}</strong><span>{systemLabel('category', key, key[0].toUpperCase() + key.slice(1), language)}</span></div>)}</div><div className="callout warning mt-2">{t('challenge.byokDescription')}</div></div>
        </div>
        <aside className="detail-sidebar stack">
          <div className="card card-pad"><div className="eyebrow mb-3">{t('challenge.constraints')}</div><dl className="spec-list"><div><dt>{t('challenge.tokenBudget')}</dt><dd>{formatNumber(problem.constraints.tokenBudget)}</dd></div><div><dt>{t('challenge.toolCalls')}</dt><dd>&le; {formatNumber(problem.constraints.toolCallLimit)}</dd></div><div><dt>{t('challenge.costPerCase')}</dt><dd>&le; {formatMoney(problem.constraints.maxCost)}</dd></div><div><dt>{t('challenge.latencyPerCase')}</dt><dd>&le; {formatDuration(problem.constraints.maxLatencyMs)}</dd></div><div><dt>{t('challenge.reputationTier')}</dt><dd className="purple">+{formatNumber(problem.reward)}</dd></div></dl><div className="divider" /><div className="eyebrow mb-2">{t('challenge.currentBestAllLanes')}</div><div className="score-large" style={{ fontSize: 49 }}>{formatNumber(problem.stats.bestScore)}<small> / 1000</small></div><div className="flex justify-between small mt-2"><span className="muted">{t('common.builders')}</span><span className="mono">{formatNumber(problem.stats.participants)}</span></div><div className="flex justify-between small mt-1"><span className="muted">{t('challenge.agentBuilds')}</span><span className="mono">{formatNumber(problem.stats.builds)}</span></div><Link href={`/builder?problem=${problem.id}`} className="button primary w-full mt-3"><Icon name="Boxes" /> {t('navigation.openBuilder')}</Link></div>
          <div className="callout"><Icon name="GitFork" />{t('home.remixCallout')}</div>
          <div className="card card-pad"><div className="eyebrow mb-2">{t('challenge.deterministicScoring')}</div><div className="spec-list small">{scoreWeights.map(([label, value]) => <div key={label}><span className="muted">{label}</span><span className="mono">{value}</span></div>)}</div></div>
        </aside>
      </div>}
      <Footer />
    </main>
  );
}
function LeaderboardSection({ problemId }: { problemId?: string }) {
  const { t } = useLocale();
  const query = useSearchParams();
  const { boot } = useSession();
  const [selectedTier, setTier] = useState(query.get('tier') || 'byok');
  const tier = selectedTier === 'demo' && boot?.demoMode ? 'demo' : selectedTier === 'verified' ? 'verified' : 'byok';
  const [sort, setSort] = useState('overall');
  const { data, error, loading, reload } = useData<any[]>(`leaderboard?tier=${tier}&sort=${sort}${problemId ? `&problemId=${problemId}` : ''}`);
  const sortOptions = [['overall', 'Trophy', t('leaderboard.overall')], ['cheapest', 'Zap', t('leaderboard.cheapest')], ['fastest', 'Timer', t('leaderboard.fastest')], ['robust', 'ShieldCheck', t('leaderboard.robust')], ['minimalist', 'Boxes', t('leaderboard.minimalist')]] as const;
  return <><div className="leaderboard-controls"><div className="tabs" style={{ margin: 0, padding: 0, border: 0 }}>{sortOptions.map(([value, icon, label]) => <button key={value} className={cn('tab', sort === value && 'active')} onClick={() => setSort(value)}><Icon name={icon} />{label}</button>)}</div><select aria-label={t('leaderboard.filterChallenge')} value={tier} onChange={(event) => setTier(event.target.value)}>{boot?.demoMode && <option value="demo">{t('leaderboard.demoLane')}</option>}<option value="byok">{t('leaderboard.byokLane')}</option><option value="verified">{t('leaderboard.verifiedLane')}</option></select></div><LaneNote tier={tier} /><div className="mt-3">{loading ? <Loading /> : error ? <ErrorNotice message={error} retry={reload} /> : <LeaderTable rows={data ?? []} />}</div><p className="small dim mt-2">{t('challenge.scoringNote')}</p></>;
}
function Leaderboard() {
  const { t } = useLocale();
  const { data: problems } = useData<any[]>('problems');
  const query = useSearchParams();
  const [problemId, setProblemId] = useState(query.get('problemId') || '');
  return <main className="container page"><PageHeading eyebrow={t('navigation.leaderboards')} title={t('leaderboard.title')} description={t('leaderboard.description')} action={<select aria-label={t('leaderboard.filterChallenge')} value={problemId} onChange={(event) => setProblemId(event.target.value)} style={{ width: 240 }}><option value="">{t('challenges.allChallenges')}</option>{problems?.map((problem) => <option value={problem.id} key={problem.id}>{problem.title}</option>)}</select>} /><LeaderboardSection key={problemId} problemId={problemId || undefined} /><Footer /></main>;
}
function FailureLab({ problem, onSubmitted }: { problem: any; onSubmitted: () => void }) {
  const { t, language } = useLocale();
  const { user } = useSession();
  const providers = useData<any>(user ? 'providers' : null);
  const toast = useToast();
  const [input, setInput] = useState('');
  const [reason, setReason] = useState('');
  const [provider, setProvider] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; status?: string; actual?: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    if (provider !== 'demo' && !window.confirm(t('failure.providerConfirm'))) return;
    setBusy(true);
    try {
      const response = await post<{ message: string; status?: string; actual?: string }>('failure-cases', { problemId: problem.id, input, reason, providerId: provider, consent: provider !== 'demo' });
      setResult(response);
      toast(response.message);
      onSubmitted();
    } catch (error) {
      toast(localizeError(error, t), true);
    } finally {
      setBusy(false);
    }
  };

  return <div className="detail-grid"><div className="stack">
    <div className="card card-pad"><div className="flex items-center gap-2 mb-2"><Icon name="Crosshair" className="purple" /><h3>{t('failure.title')}</h3></div><p className="muted small mb-3">{t('failure.publicBuildHint')}</p>
      {user ? <form onSubmit={submit}><div className="field"><label className="label" htmlFor="failure-input">{t('failure.input')}</label><textarea id="failure-input" required maxLength={4000} rows={5} value={input} onChange={(event) => setInput(event.target.value)} placeholder={t('failure.input')} /></div><div className="field"><label className="label" htmlFor="failure-reason">{t('failure.reason')}</label><textarea id="failure-reason" required minLength={8} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('failure.reason')} /></div><div className="flex gap-2"><select aria-label={t('failure.providerLabel')} value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">{t('builder.manageCredentials')}</option>{providers.data?.demo && <option value="demo">{t('failure.demoEngine')}</option>}{providers.data?.platform && <option value="platform">{t('failure.platformGateway')}</option>}{providers.data?.credentials?.map((credential: any) => <option key={credential.id} value={credential.id}>{credential.name}</option>)}</select><Button type="submit" variant="default" disabled={busy || !provider}>{busy ? <span className="spinner" /> : <Icon name="Crosshair" />}{t('failure.testTopAgent')}</Button></div></form> : <Link href={`/login?next=/challenges/${problem.slug}`} className="button primary">{t('failure.signIn')} <Icon name="ArrowRight" /></Link>}
      {result && <div className={cn('callout mt-3', result.status === 'verified' ? '' : 'purple')}><strong>{result.message}</strong>{result.actual && <pre className="mt-2">{result.actual}</pre>}</div>}
    </div>
    <div><SectionHeading title={t('failure.title')} />{problem.failures.length ? problem.failures.map((failure: any) => <div className="card card-pad mb-2" key={failure.id}><div className="flex justify-between mb-2"><span className={cn('chip', failure.status === 'verified' ? 'green' : 'purple')}>{systemLabel('failure-status', failure.status, failure.status.replaceAll('_', ' ').toUpperCase(), language)}</span><span className="mono small dim">{systemLabel('tier', failure.tier, failure.tier.toUpperCase(), language)}</span></div><p className="small">{failure.reason}</p><p className="small muted mt-1">{t('failure.by', { creator: failure.creator })}</p></div>) : <Empty title={t('failure.noCracks')} description={t('failure.noCracksDescription')} />}</div>
  </div><aside className="stack"><div className="callout purple"><Icon name="ShieldCheck" />{t('failure.privateKeyNotice')}</div><div className="card card-pad"><h3>{t('failure.hunterRules')}</h3><p className="small muted mt-2">{t('failure.hunterRulesDescription')}</p></div></aside></div>;
}
function CatalogDetailPage({ detail }: { detail: CatalogDetail }) {
  const { t, language, formatNumber } = useLocale();
  const localized = localizeSystemContent(detail.kind, { id: detail.id, name: detail.name, description: detail.description, effect: detail.effect }, language);
  const evidence = detail.evidence;
  const competitiveStats = evidence.competitiveStats;
  return (
    <main className="container page catalog-detail-page">
      <div className="catalog-detail-back"><Link href="/workshop" className="button small ghost"><Icon name="ArrowRight" className="back-icon" /> Workshop</Link></div>
      <PageHeading
        eyebrow={`${detail.kind.toUpperCase()} / ${detail.id.toUpperCase()}`}
        title={localized.name ?? detail.name}
        description={localized.description ?? detail.description}
        action={<span className="chip subtle">VERSION {detail.version.version}</span>}
      />
      <div className="catalog-detail-grid">
        <div className="stack">
          <section className="card card-pad catalog-section">
            <div className="eyebrow">SAFE SOURCE PROJECTION</div>
            <pre className="catalog-instruction">{detail.sourceProjection.instruction}</pre>
            <p className="small muted mt-2">{detail.sourceProjection.note}</p>
            <div className="catalog-meta-row mt-3">
              <span><strong>Source</strong> {detail.version.source}</span>
              <span><strong>Author</strong> {detail.author}</span>
              <span><strong>Origin</strong> {detail.contentOrigin}</span>
            </div>
          </section>
          <section className="card card-pad catalog-section">
            <div className="eyebrow">PARAMETERS</div>
            {detail.parameters.length ? <div className="catalog-parameters">{detail.parameters.map((parameter: CatalogParameter) => <div className="catalog-parameter" key={parameter.name}><div className="flex items-center justify-between gap-2"><strong>{parameter.name}</strong><span className="chip subtle">{parameter.type}{parameter.required ? ' / required' : ' / optional'}</span></div><p className="small muted mt-1">{parameter.description}</p>{parameter.example !== undefined && <code className="catalog-example-value">{JSON.stringify(parameter.example)}</code>}</div>)}</div> : <p className="small muted">No parameters.</p>}
            <pre className="catalog-schema mt-3">{JSON.stringify(detail.parameterSchema, null, 2)}</pre>
          </section>
          <section className="card card-pad catalog-section">
            <div className="eyebrow">STATIC EXAMPLES / NO MODEL CALL</div>
            <p className="small muted mb-3">Examples are maintained metadata. Viewing this page performs no model invocation and does not create a run.</p>
            <div className="catalog-examples">{detail.examples.map((example: CatalogExample) => <article className="catalog-example" key={example.id}><div className="flex items-center justify-between gap-2"><strong>{example.title}</strong><span className={`chip ${example.outcome === 'success' ? 'green' : 'purple'}`}>{example.outcome.toUpperCase()}</span></div><div className="catalog-example-block"><span>INPUT</span><pre>{example.input}</pre></div><div className="catalog-example-block"><span>OUTPUT</span><pre>{example.output}</pre></div><p className="small muted">{example.explanation}</p><div className="catalog-example-footer"><span>{example.visibility} / {example.provenance}</span><span>{example.version} / {example.modelBinding.modelId}</span><span>{example.source.ref} / {example.capturedAt}</span></div></article>)}</div>
          </section>
        </div>
        <aside className="stack">
          <section className="card card-pad catalog-section">
            <div className="eyebrow">EXECUTION BOUNDARY</div>
            <div className="catalog-boundary-grid"><div><span className="catalog-boundary-label">{t('common.tokens')}</span><strong>{formatNumber(detail.boundary.cost.tokenBudget.min)}–{formatNumber(detail.boundary.cost.tokenBudget.max)}</strong></div><div><span className="catalog-boundary-label">{t('common.tools')}</span><strong>{detail.boundary.cost.toolCalls.min}–{detail.boundary.cost.toolCalls.max}</strong></div><div><span className="catalog-boundary-label">MODEL CALLS</span><strong>{detail.boundary.cost.modelCalls.min}–{detail.boundary.cost.modelCalls.max}</strong></div><div><span className="catalog-boundary-label">{t('common.executionTime')}</span><strong>{formatNumber(detail.boundary.latency.expectedMs.min)}–{formatNumber(detail.boundary.latency.expectedMs.max)} ms</strong></div></div>
            <p className="small muted mt-3">{detail.boundary.cost.note}</p><p className="small muted mt-2">{detail.boundary.latency.note}</p><div className="catalog-capabilities mt-3">{Object.entries(detail.boundary.capabilities).filter(([key]) => key !== 'note').map(([key, value]) => <span className={`chip ${value ? 'warning' : 'green'}`} key={key}>{key}: {value ? 'allowed' : 'blocked'}</span>)}</div>
          </section>
          <section className="card card-pad catalog-section">
            <div className="eyebrow">VERSION / MODEL BINDING</div>
            <dl className="catalog-dl"><div><dt>Version</dt><dd>{detail.version.version}</dd></div><div><dt>Source ref</dt><dd className="mono">{detail.version.sourceRef}</dd></div><div><dt>Published</dt><dd>{detail.version.publishedAt}</dd></div><div><dt>Strategy</dt><dd>{detail.modelBinding.strategy}</dd></div><div><dt>Model</dt><dd>{detail.modelBinding.modelId}</dd></div></dl>
            <p className="small muted mt-3">{detail.modelBinding.note}</p>
          </section>
          <section className="card card-pad catalog-section">
            <div className="eyebrow">EVIDENCE SOURCES</div>
            <div className="catalog-evidence"><div><strong>Competitive statistics</strong><p className="small muted">{competitiveStats?.label}</p>{competitiveStats && competitiveStats.usageCount !== null && <span className="chip subtle">{formatNumber(competitiveStats.usageCount)} associated versions</span>}</div><div><strong>Author self-test</strong><p className="small muted">{evidence.authorSelfTest.label}</p><span className="chip subtle">{evidence.authorSelfTest.status}</span></div><div><strong>Platform evaluation</strong><p className="small muted">{evidence.platformEvaluation.label}</p><span className="chip subtle">{evidence.platformEvaluation.status}</span></div></div>
          </section>
        </aside>
      </div>
      <Footer />
    </main>
  );
}
function Workshop() {
  const { t, language, formatNumber, formatPercent } = useLocale();
  const searchParams = useSearchParams();
  const selectedSkill = searchParams.get('skill');
  const selectedTool = searchParams.get('tool');
  const selectedKind = selectedSkill ? 'skill' : selectedTool ? 'tool' : null;
  const selectedId = selectedSkill || selectedTool;
  const skills = useData<any[]>('skills');
  const tools = useData<any[]>('tools');
  const detail = useData<CatalogDetail>(selectedKind && selectedId ? `${selectedKind}s/${selectedId}` : null);
  if (selectedKind) {
    if (detail.loading) return <main className="container page"><Loading /></main>;
    if (detail.error) return <main className="container page"><ErrorNotice message={detail.error} retry={detail.reload} /></main>;
    return detail.data ? <CatalogDetailPage detail={detail.data} /> : null;
  }
  return <main className="container page"><PageHeading eyebrow={t('workshop.eyebrow')} title={t('workshop.title')} description={t('workshop.description')} /><SectionHeading title={t('workshop.skillCards')} count={skills.data?.length ?? 0} />{skills.loading ? <Loading /> : skills.error ? <ErrorNotice message={skills.error} /> : <div className="grid-3">{skills.data?.map((skill) => { const localized = localizeSystemContent('skill', skill, language); return <div className="card skill-card" key={skill.id} id={skill.id}><div className="flex justify-between"><div className="icon-box purple"><Icon name={skill.icon} /></div><span className="chip subtle">SKILL / {skill.id.toUpperCase()}</span></div><h3>{localized.name ?? skill.name}</h3><p>{localized.description ?? skill.description}</p><div className="skill-effect"><Icon name="Zap" size={11} /> {localized.effect ?? skill.effect}</div><footer><span><span className="catalog-stat-label">ARENA / </span>{formatNumber(skill.usageCount)} {t('workshop.builds')} <span className="dim">/</span> {skill.successRate === null ? t('workshop.noData') : `${formatPercent(skill.successRate)} ${t('workshop.pass')}`}{skill.simulated ? ` (${t('workshop.demo')})` : ''}</span><div className="flex gap-2"><Link className="button small ghost" href={`/workshop?skill=${skill.id}`}>Inspect <Icon name="Eye" /></Link><Link className="button small ghost" href={`/builder?problem=messy-json&skill=${skill.id}`}>{t('workshop.equip')} <Icon name="Plus" /></Link></div></footer></div>; })}</div>}
    <div className="mt-4"><SectionHeading title={t('workshop.toolRack')} count={tools.data?.length ?? 0} />{tools.loading ? <Loading /> : tools.error ? <ErrorNotice message={tools.error} /> : <div className="grid-3">{tools.data?.map((tool) => { const localized = localizeSystemContent('tool', tool, language); return <div className="card card-pad catalog-list-card" key={tool.id}><div className="flex items-center gap-2 mb-2"><Icon name={tool.icon} className="accent" /><h3 style={{ fontSize: 15 }}>{localized.name ?? tool.name}</h3></div><p className="small muted">{localized.description ?? tool.description}</p><span className="chip subtle mt-2">{t('workshop.registeredTool')}</span><div className="mt-3"><Link className="button small ghost" href={`/workshop?tool=${tool.id}`}>Inspect <Icon name="Eye" /></Link></div></div>; })}</div>}</div><Footer /></main>;
}

function Providers() {
  const { t, formatMoney } = useLocale();
  const { user, loading: sessionLoading } = useSession();
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useData<any>(user ? 'providers' : null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!sessionLoading && !user) router.replace('/login?next=/providers'); }, [user, sessionLoading, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const protocol = parseProviderProtocol(values.get('protocol'));
    const providerValues = {
      name: String(values.get('name') ?? ''),
      baseUrl: normalizeProviderBaseUrl(protocol, String(values.get('baseUrl') ?? '')),
      modelId: String(values.get('modelId') ?? ''),
      apiKey: String(values.get('apiKey') ?? ''),
    };
    const issue = validateProviderFormValues(providerValues, t);
    if (issue) {
      const input = form.elements.namedItem(issue.field);
      if (input instanceof HTMLElement) input.focus();
      toast(issue.message, true);
      return;
    }
    setSaving(true);
    try {
      await post('providers', { protocol, ...providerValues, inputPrice: values.get('inputPrice') ? Number(values.get('inputPrice')) : null, outputPrice: values.get('outputPrice') ? Number(values.get('outputPrice')) : null });
      form.reset();
      toast(t('providers.saved'));
      reload();
    } catch (error) {
      toast(localizeError(error, t), true);
    } finally {
      setSaving(false);
    }
  };

  if (sessionLoading || loading) return <div className="container"><Loading /></div>;
  if (!user) return null;
  const credentials = data?.credentials ?? [];
  const price = (value: number | null) => value === null ? t('providers.unknown') : `${formatMoney(value)}/1M`;
  return <main className="container page"><PageHeading eyebrow={t('providers.eyebrow')} title={t('providers.pageTitle')} description={t('providers.pageDescription')} action={<span className="chip green"><Icon name="Lock" size={12} /> {t('providers.encryption')}</span>} />{error && <ErrorNotice message={error} retry={reload} />}<div className="grid-2"><div className="stack">
    <div className="card"><div className="card-header"><h3 style={{ fontSize: 16 }}>{t('providers.yourEngines')}</h3><span className="chip">{t('providers.credentialCount', { count: credentials.length })}</span></div>{data?.demo && <div className="provider-card"><div className="icon-box purple"><Icon name="Sparkles" /></div><div className="grow"><h3>{t('providers.forgeSimulation')}</h3><p className="provider-url">{t('providers.noNetworkCalls')}</p><span className="chip purple">{t('providers.simulatedFree')}</span></div></div>}{data?.platform && <div className="provider-card"><div className="icon-box"><Icon name="Globe" /></div><div><h3>{t('providers.platformGateway')}</h3><p className="provider-url">{data.platform.modelId}</p><span className="chip green">{t('providers.serverConfigured')}</span></div></div>}{credentials.map((credential: any) => <div className="provider-card" key={credential.id}><div className="icon-box"><Icon name="Cpu" /></div><div className="grow"><h3>{credential.name}</h3><ProviderProtocolBadge protocol={credential.protocol} /><p className="provider-url">{credential.baseUrl}</p><code>{credential.modelId} <span className="dim">/</span> {credential.keyMask}</code><p className="provider-url">{t('providers.inputOutputPricing', { input: price(credential.inputPrice), output: price(credential.outputPrice) })}</p></div><button className="button icon ghost" aria-label={t('providers.delete', { name: credential.name })} onClick={async () => { if (!window.confirm(t('providers.deleteConfirm', { name: credential.name }))) return; try { await api(`providers/${credential.id}`, { method: 'DELETE' }); toast(t('providers.deleted')); reload(); } catch (error) { toast(localizeError(error, t), true); } }}><Icon name="Trash2" /></button></div>)}</div>
    <div className="callout"><Icon name="ShieldCheck" />{t('providers.keyPrivacy')}</div><div className="card card-pad"><div className="eyebrow mb-2">{t('providers.networkAllowlist')}</div><p className="small muted">{t('providers.allowlistDescription')}</p><div className="flex wrap gap-1 mt-2">{data?.allowedHosts?.map((host: string) => <span className="chip" key={host}>{host}</span>)}</div><p className="small dim mt-2">{t('providers.httpsNotice')}</p></div>
  </div><form className="card card-pad" onSubmit={submit}><h3 className="mb-3">{t('providers.addProvider')}</h3><div className="form-grid"><div className="field"><label htmlFor="provider-name" className="label">{t('providers.displayName')}</label><input id="provider-name" name="name" required maxLength={PROVIDER_FIELD_LIMITS.name} placeholder={t('providers.displayName')} /></div><div className="field"><label htmlFor="provider-model" className="label">{t('providers.modelId')}</label><input id="provider-model" name="modelId" required maxLength={PROVIDER_FIELD_LIMITS.modelId} placeholder={t('providers.formModelPlaceholder')} className="mono-input" /></div></div><ProviderProtocolFields /><div className="field"><label htmlFor="provider-key" className="label">{t('providers.apiKey')}</label><input id="provider-key" name="apiKey" type="password" autoComplete="new-password" required minLength={1} maxLength={PROVIDER_FIELD_LIMITS.apiKey} placeholder={t('providers.keyPlaceholder')} className="mono-input" /><small>{t('providers.keyBound')}</small></div><div className="divider" /><div className="eyebrow mb-2">{t('providers.pricingOptional')}</div><p className="small dim mb-2">{t('providers.pricingUnknownHint')}</p><div className="form-grid"><div className="field"><label htmlFor="input-price" className="label">{t('providers.inputPricing')}</label><input id="input-price" name="inputPrice" type="number" min="0" max="10000" step="any" placeholder={t('providers.formUnknown')} /></div><div className="field"><label htmlFor="output-price" className="label">{t('providers.outputPricing')}</label><input id="output-price" name="outputPrice" type="number" min="0" max="10000" step="any" placeholder={t('providers.formUnknown')} /></div></div><Button type="submit" variant="default" className="w-full" disabled={saving}>{saving ? <span className="spinner" /> : <Icon name="Lock" />}{t('providers.encryptButton')}</Button></form></div><Footer /></main>;
}
function CreateProblem() {
  const { t } = useLocale();
  const { user } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ title: string; message?: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const form = Object.fromEntries(new FormData(event.currentTarget));
      const response = await post<{ title: string; message?: string }>('problems', form);
      setResult(response);
      toast(t('problem.submittedMessage'));
    } catch (error) {
      toast(localizeError(error, t), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container page" style={{ maxWidth: 1000 }}>
      <PageHeading eyebrow={t('problem.createEyebrow')} title={t('problem.createTitle')} description={t('problem.createDescription')} />
      {!user ? <Empty title={t('problem.signInToContribute')} description={t('problem.contributeDescription')} action={<Link href="/login?next=/problems/new" className="button primary">{t('auth.signIn')}</Link>} /> : result ? <div className="card card-pad"><span className="chip amber">{t('problem.pendingReview')}</span><h2 className="mt-3">{result.title}</h2><p className="muted mt-2">{t('problem.submittedMessage')}</p><Link href={`/profile/${user.id}`} className="button primary mt-3">{t('problem.viewContributions')} <Icon name="ArrowRight" /></Link></div> : <form className="card card-pad" onSubmit={submit}>
        <div className="form-grid">
          <div className="field"><label className="label" htmlFor="problem-title">{t('problem.titleLabel')}</label><input id="problem-title" name="title" minLength={5} maxLength={100} required placeholder={t('problem.titlePlaceholder')} /></div>
          <div className="field"><label className="label" htmlFor="problem-category">{t('problem.categoryLabel')}</label><select id="problem-category" name="category"><option>Productivity</option><option>Data extraction</option><option>Security</option><option>Customer support</option><option>Other</option></select></div>
        </div>
        <div className="field"><label className="label" htmlFor="problem-description">{t('problem.descriptionLabel')}</label><textarea id="problem-description" name="description" rows={5} minLength={20} maxLength={3000} required placeholder={t('problem.descriptionPlaceholder')} /></div>
        <div className="field"><label className="label" htmlFor="problem-why">{t('problem.whyLabel')}</label><textarea id="problem-why" name="why" rows={3} minLength={10} maxLength={2000} required placeholder={t('problem.whyPlaceholder')} /></div>
        <div className="form-grid"><div className="field"><label className="label" htmlFor="problem-input">{t('problem.exampleInputLabel')}</label><textarea className="mono" id="problem-input" name="exampleInput" rows={5} maxLength={4000} required /></div><div className="field"><label className="label" htmlFor="problem-output">{t('problem.expectedOutputLabel')}</label><textarea className="mono" id="problem-output" name="expectedOutput" rows={5} maxLength={4000} required /></div></div>
        <Button variant="default" type="submit" disabled={busy}>{busy ? <><span className="spinner" />{t('problem.submitting')}</> : <><Icon name="Send" />{t('problem.submitReview')}</>}</Button>
      </form>}
      <Footer />
    </main>
  );
}
function Profile({ id }: { id: string }) {
  const { t, language, formatNumber, formatDate } = useLocale();
  const { user, loading: sessionLoading } = useSession();
  const { data: profile, error, loading, reload } = useData<any>(id === 'me' && !user ? null : `profile/${id}`);

  if (id === 'me' && !user && !sessionLoading) return <main className="container page"><Empty title={t('profile.identityAwaiting')} description={t('profile.signInToSee')} action={<Link href="/login?next=/profile/me" className="button primary">{t('auth.signIn')}</Link>} /></main>;
  if (loading || sessionLoading) return <Loading />;
  if (error || !profile) return <main className="container page"><ErrorNotice message={error || t('errors.unknownPage')} retry={reload} /></main>;

  const level = Math.max(1, Math.floor(profile.reputation / 100) + 1);
  const stats = [
    [t('profile.benchmarkElo'), profile.elo, 'Target'],
    [t('profile.reputation'), formatNumber(profile.reputation), 'Zap'],
    [t('profile.globalRank'), `#${formatNumber(profile.rank)}`, 'Trophy'],
  ] as const;

  return (
    <main className="container page">
      <div className="profile-hero"><Avatar name={profile.name} large /><div className="grow"><div className="eyebrow">{t('profile.eyebrow')} {profile.isSeed ? ` / ${t('profile.seed')}` : ''}</div><h1>{profile.name}</h1><span className="chip green">{t('profile.levelBuilder', { level })}</span><span className="small dim" style={{ marginLeft: 13 }}>{t('profile.joined', { date: formatDate(profile.createdAt) })}</span></div>{profile.owner && <Link href="/providers" className="button outline"><Icon name="Settings" /> {t('profile.engines')}</Link>}</div>
      <div className="profile-stats">{stats.map(([label, value, icon]) => <div className="profile-stat" key={label}><div className="flex justify-between"><span className="eyebrow">{label}</span><Icon name={icon} className="dim" size={14} /></div><strong>{value}</strong></div>)}</div>
      <p className="small dim">{t('profile.eloDescription')}</p>
      <div className="badge-grid">{profile.badges.map((badge: any) => { const localized = localizeSystemContent('badge', badge, language); return <div className={cn('badge-card', badge.earned && 'earned')} title={localized.description ?? badge.description} key={badge.id}><Icon name={badge.icon} /><strong>{localized.name ?? badge.name}</strong><small>{badge.earned ? t('profile.unlocked') : t('profile.locked')}</small></div>; })}</div>
      <div className="grid-2"><div><SectionHeading title={t('profile.builds')} count={profile.builds.length} href="/challenges" link={t('navigation.startBuilding')} />{profile.builds.length ? profile.builds.map((build: any) => { const problem = localizeSystemContent('problem', { id: build.problemId, title: build.problemId }, language); return <Link href={`/builds/${build.id}`} className="card provider-card mb-2" key={build.id}><div className="icon-box"><Icon name="Boxes" /></div><div className="grow"><h3>{build.title}</h3><p className="provider-url">{t('profile.buildVisibility', { problem: problem.title ?? build.problemId, visibility: build.visibility === 'public' ? t('common.public') : t('common.private') })}</p></div><span className="mono accent">{formatNumber(build.bestScore)}</span><Icon name="ArrowUpRight" className="dim" /></Link>; }) : <div className="card"><Empty title={t('profile.firstBuildTitle')} description={t('profile.firstBuildDescription')} action={<Link className="button primary" href="/challenges">{t('navigation.exploreChallenges')}</Link>} /></div>}</div>
        <div className="stack"><div className="card card-pad"><h3>{t('profile.communityImpact')}</h3><dl className="spec-list mt-3"><div><dt>{t('profile.problemsContributed')}</dt><dd>{formatNumber(profile.problems.length)}</dd></div><div><dt>{t('profile.failureCases')}</dt><dd>{formatNumber(profile.failureCount)}</dd></div><div><dt>{t('profile.forksCreated')}</dt><dd>{formatNumber(profile.forkCount)}</dd></div></dl></div>{profile.problems.length > 0 && <div className="card card-pad"><h3 className="mb-2">{t('profile.problemSubmissions')}</h3>{profile.problems.map((problem: any) => <div className="flex items-center justify-between small mt-2" key={problem.id}><span>{problem.title}</span><span className="chip amber">{problem.status === 'pending' ? t('problem.pendingReview') : problem.status}</span></div>)}</div>}<div className="card card-pad"><h3 className="mb-2">{t('profile.reputationLog')}</h3>{profile.reputationHistory.length ? profile.reputationHistory.map((entry: any) => <div className="flex justify-between small mt-2" key={entry.id}><span className="muted">{entry.reason.replaceAll('-', ' ')}</span><span className="mono accent">+{formatNumber(entry.points)} {t('common.rp')}</span></div>) : <p className="small dim">{t('profile.reputationEmpty')}</p>}</div></div>
      </div>
      <Footer />
    </main>
  );
}
function BuildDetail({ id }: { id: string }) {
  const { t, language, formatNumber, formatMoney, formatDuration, formatDate } = useLocale();
  const query = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { user } = useSession();
  const version = query.get('version');
  const { data: build, error, loading, reload } = useData<any>(`builds/${id}${version ? `?version=${version}` : ''}`);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error || !build) return <main className="container page"><ErrorNotice message={error || t('errors.unknownPage')} retry={reload} /></main>;

  const localizedProblem = localizeSystemContent('problem', build.problem, language);
  const best = [...build.submissions].filter((submission: any) => submission.versionId === build.version.id).sort((a: any, b: any) => b.score - a.score)[0];
  const laneLabel = !best ? t('build.scorePending') : best?.tier === 'byok' ? t('leaderboard.byokLane') : best?.tier === 'verified' ? t('leaderboard.verifiedLane') : t('leaderboard.demoLane');
  const fork = async () => {
    if (!user) {
      router.push(`/login?next=/builds/${id}`);
      return;
    }
    setBusy(true);
    try {
      const forked = await post<{ id: string }>(`builds/${id}/fork`, { versionId: build.version.id });
      toast(t('build.forkCreated'));
      router.push(`/builder?build=${forked.id}`);
    } catch (error) {
      toast(localizeError(error, t), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container page">
      <div className="breadcrumb"><Link href={`/challenges/${build.problem.slug}`}>{localizedProblem.title ?? build.problem.title}</Link><Icon name="ChevronRight" size={12} /><span>{t('build.buildNumber', { id: build.id.slice(0, 8) })}</span></div>
      <PageHeading eyebrow={t('build.assetVersion', { revision: build.version.revision })} title={build.title} description={`${t('build.forgedBy', { name: build.creator.name })}${build.parentBuildId ? t('build.forkedFrom') : ''}`} action={<div className="flex gap-2">{build.owner && <Link className="button outline" href={`/builder?build=${id}&version=${build.version.id}`}><Icon name="Code2" /> {t('build.editVersion')}</Link>}<Button variant="default" onClick={fork} disabled={busy || !build.canFork}>{busy ? <span className="spinner" /> : <Icon name="GitFork" />}{t('build.forkRemix')}</Button></div>} />
      <div className="flex gap-2 mb-3"><span className={cn('chip', build.promptVisible ? 'green' : 'purple')}><Icon name={build.promptVisible ? 'Eye' : 'EyeOff'} size={11} />{build.promptVisible ? t('build.promptVisible') : t('build.secretPrompt')}</span><span className="chip">{t('build.forks', { count: formatNumber(build.forkCount) })}</span>{best && <span className="chip purple">{t('build.lane', { lane: laneLabel })}</span>}</div>
      <div className="detail-grid"><div><div className="card card-pad"><SectionHeading title={t('build.workflowBlueprint')} count={build.workflow.nodes.length} />{!build.promptVisible && <div className="callout purple">{t('build.workflowPrivate')}</div>}<div className="build-graph-preview"><WorkflowPreview workflow={build.workflow} /></div><div className="flex wrap gap-1 mt-2">{build.workflow.nodes.filter((node: any) => ['skill', 'tool'].includes(node.kind)).map((node: any) => <span className="chip" key={node.id}><Icon name={node.kind === 'skill' ? 'Sparkles' : 'Wrench'} size={10} />{node.kind === 'skill' ? systemLabel('skill', node.config.skillId || '', node.config.skillId || '', language) : systemLabel('tool', node.config.toolId || '', node.config.toolId || '', language)}</span>)}</div></div>{build.promptVisible && build.workflow.nodes.filter((node: any) => node.kind === 'prompt').map((node: any) => <div className="card card-pad mt-3" key={node.id}><div className="flex justify-between mb-2"><h3 style={{ fontSize: 16 }}>{node.label}</h3><span className="chip">{t('build.promptTokens', { count: formatNumber(Math.ceil((node.config.systemPrompt?.length || 0) / 4)) })}</span></div><pre>{node.config.systemPrompt}</pre><div className="divider" /><div className="eyebrow mb-2">{t('builder.userTemplate')}</div><pre className="muted">{node.config.userTemplate}</pre></div>)}<div className="card card-pad mt-3"><SectionHeading title={t('build.version')} count={build.history.length} />{build.history.map((history: any) => <div className="flex items-center justify-between small mt-2" key={history.id}><span className="mono">{t('build.version', { revision: history.revision })} <span className="dim">/ {history.title}</span></span><span className="dim">{formatDate(history.createdAt)}</span><Link href={`/builds/${id}?version=${history.id}`} className="section-link">{t('build.inspect')} <Icon name="ArrowUpRight" /></Link></div>)}</div></div>
        <aside className="stack"><div className="card card-pad"><div className="eyebrow mb-3">{t('common.score')}</div>{best ? <><div className="score-large">{formatNumber(best.score)}<small> / 1000</small></div><div className="divider" /><GradeList score={{ ...best, grades: Object.fromEntries(['accuracy', 'robustness', 'security', 'efficiency', 'elegance'].map((key) => [key, best[key] >= .97 ? 'SS' : best[key] >= .9 ? 'S' : best[key] >= .8 ? 'A' : best[key] >= .65 ? 'B' : 'C'])) }} /><div className="divider" /><dl className="spec-list"><div><dt>{t('builder.nodeProvider')}</dt><dd className="small">{best.model}</dd></div><div><dt>{t('common.totalEnergy')}</dt><dd>{formatNumber(best.tokens)}</dd></div><div><dt>{t('challenge.costPerCase')}</dt><dd>{formatMoney(best.cost)}</dd></div><div><dt>{t('challenge.latencyPerCase')}</dt><dd>{formatDuration(best.latency)}</dd></div><div><dt>{t('builder.workflowCanvas')}</dt><dd>{formatNumber(best.nodes)}</dd></div></dl></> : <p className="small muted">{t('build.scorePending')}</p>}</div><div className="callout"><Icon name="GitFork" />{t('build.remixes')}</div>{build.parentBuildId && <Link className="button outline" href={`/builds/${build.parentBuildId}`}><Icon name="GitFork" /> {t('build.parent')}</Link>}</aside>
      </div>
      <Footer />
    </main>
  );
}
function Login() {
  const { t } = useLocale();
  const { boot, user } = useSession();
  const router = useRouter();
  const query = useSearchParams();
  const toast = useToast();
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextRaw = query.get('next') || '/challenges';
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') && !nextRaw.includes('\\') ? nextRaw : '/challenges';

  useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  async function login(email: string, password: string, name?: string) {
    setBusy(true);
    setError('');
    try {
      const response = register ? await authClient.signUp.email({ email, password, name: name || 'Builder' }) : await authClient.signIn.email({ email, password });
      if (response.error) throw new Error(response.error.message || t('errors.authentication'));
      toast(register ? t('auth.welcome') : t('auth.welcomeBack'));
      router.replace(next);
    } catch (error) {
      setError(localizeError(error, t));
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell"><div className="auth-story"><div className="eyebrow">{t('auth.storyEyebrow')}</div><h1>{t('auth.storyTitle').split('\n').map((line) => <span key={line}>{line}<br /></span>)}</h1><p>{t('auth.storyDescription')}</p><div className="quote">{t('auth.storyQuote').split('\n').map((line) => <span key={line}>{line}<br /></span>)}</div></div><div className="auth-form"><h2>{register ? t('auth.joinBuilders') : t('auth.backToForge')}</h2><p>{register ? t('auth.registerDescription') : t('auth.signInDescription')}</p><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void login(String(form.get('email')), String(form.get('password')), String(form.get('name') || '')); }}>{register && <div className="field"><label htmlFor="auth-name" className="label">{t('auth.builderName')}</label><input id="auth-name" name="name" required minLength={2} maxLength={60} autoComplete="nickname" placeholder={t('auth.namePlaceholder')} /></div>}<div className="field"><label htmlFor="auth-email" className="label">{t('auth.email')}</label><input id="auth-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" /></div><div className="field"><label htmlFor="auth-password" className="label">{t('auth.password')}</label><input id="auth-password" name="password" type="password" required minLength={10} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} placeholder={t('auth.passwordPlaceholder')} /></div><Button variant="default" type="submit" className="w-full" size="lg" disabled={busy}>{busy ? <span className="spinner" /> : null}{register ? t('auth.createAccount') : t('auth.signIn')} <Icon name="ArrowRight" /></Button></form>{error && <div className="error-text" role="alert">{error}</div>}<div className="auth-separator">{t('auth.continueWith')}</div><Button className="w-full" size="lg" variant="outline" disabled={!boot?.githubEnabled || busy} title={boot?.githubEnabled ? t('auth.githubContinue') : t('auth.githubSetupHint')} onClick={() => authClient.signIn.social({ provider: 'github', callbackURL: next })}><Icon name="Github" /> {t('auth.github')}{!boot?.githubEnabled ? ` (${t('auth.githubNotConfigured')})` : ''}</Button><p className="small muted center mt-3">{register ? t('auth.alreadyBuilder') : t('auth.newToArena')} <button className="button ghost small accent" onClick={() => { setRegister(!register); setError(''); }}>{register ? t('auth.signIn') : t('auth.createAccount')}</button></p><p className="small dim center mt-3">{t('auth.simulationNotice')}</p></div></main>;
}
function Route() {
  const { t } = useLocale();
  const path = usePathname();
  if (path === '/') return <Home />;
  if (path === '/challenges') return <Challenges />;
  if (path.startsWith('/challenges/')) return <ChallengeDetail slug={decodeURIComponent(path.split('/')[2])} />;
  if (path === '/leaderboard') return <Leaderboard />;
  if (path === '/workshop') return <Workshop />;
  if (path === '/providers') return <Providers />;
  if (path === '/problems/new') return <CreateProblem />;
  if (path.startsWith('/profile')) return <Profile id={path.split('/')[2] || 'me'} />;
  if (path.startsWith('/builds/')) return <BuildDetail id={path.split('/')[2]} />;
  if (path === '/builder') return <BuilderPage />;
  if (path === '/login') return <Login />;
  return <main className="container page"><Empty title={t('errors.unknownTitle')} description={t('errors.unknownPage')} action={<Link href="/" className="button primary">{t('navigation.backToArena')}</Link>} /></main>;
}
export function ArenaApp(){const session=authClient.useSession();const {data:boot}=useData('boot');return <ToastProvider><SessionContext.Provider value={{user:session.data?.user||null,loading:session.isPending,boot}}><Header/><Route/></SessionContext.Provider></ToastProvider>;}
