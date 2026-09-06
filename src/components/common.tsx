'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpFromLine, ArrowUpRight, BookOpen, Boxes,
  Braces, Calendar, Check, CheckCircle2, ChevronDown, ChevronRight, Code2, Copy, Cpu, Crosshair,
  Download, Eye, EyeOff, ExternalLink, FileJson, GitFork, Github, Globe, Inbox, Lock, LogOut,
  Minimize2, Orbit, Play, Plus, RotateCcw, Save, ScanEye, ScanText, Search, Send, Settings,
  Shield, ShieldCheck, SlidersHorizontal, Sparkles, Target, Terminal, Timer, Trash2, Trophy, Users,
  WholeWord, Wrench, X, Zap, Calculator,
} from 'lucide-react';
import { ApiError, api } from '@/lib/client-api';
import { localizeSystemContent } from '@/shared/i18n/system-content';
import { errorMessageKey } from '@/shared/i18n/error-messages';
import type { MessageKey } from '@/shared/i18n/types';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const ICONS = {
  ArrowRight, ArrowUpRight, Braces, ShieldCheck, Shield, Inbox, Boxes, Activity, Users, Zap, Trophy,
  GitFork, ArrowDownToLine, ArrowUpFromLine, Cpu, Sparkles, Wrench, Timer, Lock, Plus, Settings,
  LogOut, Play, Save, Copy, RotateCcw, Trash2, ChevronRight, Search, Code2, Terminal, Target,
  Check, AlertTriangle, Orbit, Crosshair, Minimize2, ScanText, ScanEye, Calculator,
  Calendar, WholeWord, Globe, ExternalLink, BookOpen, Eye, EyeOff, SlidersHorizontal, FileJson,
  Send, Download, X, Github, ChevronDown, CheckCircle2,
};

export function Icon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const Component = ICONS[name as keyof typeof ICONS] || Boxes;
  return <Component size={size} className={className} aria-hidden="true" />;
}

export const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; error: boolean }[]>([]);
  const notify = useCallback((message: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((value) => [...value.slice(-2), { id, message, error }]);
    setTimeout(() => setToasts((value) => value.filter((toast) => toast.id !== id)), 4800);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={cn('toast', toast.error && 'error')}>{toast.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
export const SessionContext = createContext<{ user: any; loading: boolean; boot: any }>({ user: null, loading: true, boot: null });
export const useSession = () => useContext(SessionContext);

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLocale();
  return (
    <div className="language-switcher" role="group" aria-label={t('language.label')}>
      <button
        type="button"
        className={cn('language-option', language === 'en' && 'active')}
        aria-pressed={language === 'en'}
        aria-label={t('language.english')}
        onClick={() => setLanguage('en')}
      >EN</button>
      <button
        type="button"
        className={cn('language-option', language === 'zh-CN' && 'active')}
        aria-pressed={language === 'zh-CN'}
        aria-label={t('language.simplifiedChinese')}
        onClick={() => setLanguage('zh-CN')}
      >简中</button>
    </div>
  );
}

export function useData<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    api<T>(path, { signal: controller.signal }).then((value) => { setData(value); setLoading(false); }).catch((reason) => {
      if (!controller.signal.aborted) {
        setError(reason instanceof ApiError ? reason : new ApiError(reason instanceof Error ? reason.message : String(reason)));
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading, reload: () => setRevision((value) => value + 1) };
}

export function Avatar({ name, index = 3, large = false }: { name: string; index?: number; large?: boolean }) {
  return <span className={cn('avatar', `rank-${index}`, large && 'large')}>{name.slice(0, 2).toUpperCase()}</span>;
}

export function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><Icon name="Boxes" /><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Loading() {
  const { t } = useLocale();
  return <div className="loading-state"><div className="flex items-center gap-2"><span className="spinner" />{t('common.loadingArena')}</div></div>;
}

export function localizeError(error: unknown, t: (key: MessageKey) => string): string {
  if (error instanceof ApiError) {
    const key = errorMessageKey(error.code);
    if (key) return t(key);
  }
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Request failed.';
}

export function ErrorNotice({ message, retry }: { message: string | Error; retry?: () => void }) {
  const { t } = useLocale();
  const rendered = message instanceof Error ? localizeError(message, t) : message;
  return <div className="callout danger"><Icon name="AlertTriangle" />{rendered}{retry && <button className="button small outline" style={{ marginLeft: 15 }} onClick={retry}>{t('common.tryAgain')}</button>}</div>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

export function SectionHeading({ title, count, href, link }: { title: string; count?: number; href?: string; link?: string }) {
  const { t, formatNumber } = useLocale();
  return <div className="section-heading"><div className="heading-label"><h2>{title}</h2>{count !== undefined && <span className="count">{formatNumber(count)}</span>}</div>{href && <Link href={href} className="section-link">{link ?? t('navigation.viewAll')}<Icon name="ArrowUpRight" /></Link>}</div>;
}

export const problemIcon = (problem: any) => problem.judge === 'json' ? 'Braces' : problem.judge === 'enum' ? 'Inbox' : 'ShieldCheck';

export function ChallengeCard({ problem }: { problem: any }) {
  const { language, t, formatNumber, formatPercent } = useLocale();
  const localized = localizeSystemContent('problem', problem, language);
  return <Link className="card challenge-card" href={`/challenges/${problem.slug}`}>
    <div className="flex items-center justify-between"><div className={cn('icon-box', problem.judge === 'secret' ? 'purple' : problem.judge === 'enum' ? 'amber' : '')}><Icon name={problemIcon(problem)} /></div><span className={cn('chip', problem.worldBoss ? 'purple' : 'subtle')}>{problem.worldBoss ? t('home.worldBoss') : localized.category ?? problem.category}</span></div>
    <h3>{localized.title ?? problem.title}</h3><p className="line-clamp">{localized.description ?? problem.description}</p>
    <div className="card-stats"><div><label>{t('common.bestScore')}</label><strong className="accent">{formatNumber(problem.stats.bestScore)}<span className="dim"> / 1K</span></strong></div><div><label>{t('common.builders')}</label><strong>{formatNumber(problem.stats.participants)}</strong></div><div><label>{t('common.solveRate')}</label><strong>{formatPercent(problem.stats.solveRate)}</strong></div></div>
    <div className="card-budget"><span><Icon name="Zap" />{formatNumber(problem.constraints.tokenBudget)} {t('common.tokens')}</span><span><Icon name="Wrench" />{formatNumber(problem.constraints.toolCallLimit)} {t('common.tools')}</span></div>
    <div className="card-footer"><div className={cn('difficulty', problem.difficulty === 'Expert' && 'expert')}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < (problem.difficulty === 'Starter' ? 1 : problem.difficulty === 'Expert' ? 4 : 2) ? 'on' : ''} />)}<span>{localized.difficulty ?? problem.difficulty}</span></div><span className="small muted">+{formatNumber(problem.reward)} {t('common.rp')} <span className="accent">&#8599;</span></span></div>
  </Link>;
}

export function LaneNote({ tier = 'byok' }: { tier?: string }) {
  const { t } = useLocale();
  const message = tier === 'demo'
    ? t('common.demoLaneNote')
    : tier === 'byok'
      ? t('common.byokLaneNote')
      : t('common.verifiedLaneNote');
  return <div className={cn('callout', tier === 'demo' ? 'purple' : tier === 'byok' ? 'warning' : '')}><Icon name={tier === 'verified' ? 'ShieldCheck' : tier === 'demo' ? 'Sparkles' : 'AlertTriangle'} />{message}</div>;
}

export function GradeList({ score }: { score: any }) {
  const { t } = useLocale();
  const labels: Record<string, string> = { accuracy: t('score.accuracy'), robustness: t('score.robustness'), security: t('score.security'), efficiency: t('score.efficiency'), elegance: t('score.elegance') };
  return <div className="grade-list">{Object.entries(labels).map(([key, label]) => <div className="grade-row" key={key}><span className="grade-label">{label}</span><div className="grade-bar"><span style={{ width: `${score[key] * 100}%` }} /></div><strong>{score.grades?.[key] || '-'}</strong></div>)}</div>;
}

export function LeaderTable({ rows }: { rows: any[] }) {
  const { t, formatPercent, formatNumber, formatMoney, formatDate } = useLocale();
  const columns = [
    '#',
    t('common.buildPlayer'),
    t('common.score'),
    t('common.accuracy'),
    t('common.costPerCase'),
    t('common.energyPerCase'),
    t('common.nodes'),
    t('common.engine'),
    t('common.submittedAt'),
  ];
  return rows.length ? <div className="table-wrap"><table className="arena-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={row.id}><td className={cn('rank', i < 3 && 'top')}>{String(row.rank || i + 1).padStart(2, '0')}</td><td><div className="flex items-center gap-2"><Avatar name={row.creator.name} index={i} /><div><Link href={`/builds/${row.buildId}?version=${row.versionId}`} className="build-name">{row.title}</Link><div className="player-name"><Link href={`/profile/${row.creator.id}`}>{row.creator.name}</Link>{row.creator.isSeed ? ` / ${t('common.seed')}` : ''}</div></div></div></td><td className="score">{formatNumber(row.score)}</td><td className="num">{formatPercent(row.accuracy)}</td><td className="num">{formatMoney(row.cost)}</td><td className="num">{formatNumber(row.tokens)}</td><td className="num">{formatNumber(row.nodes)}</td><td className="mono small muted">{row.model}</td><td className="mono small dim">{formatDate(row.createdAt)}</td></tr>)}</tbody></table></div> : <div className="card"><Empty title={t('common.podiumOpen')} description={t('common.noEligibleSubmissions')} action={<Link className="button primary" href="/challenges">{t('navigation.findChallenge')} <Icon name="ArrowRight" /></Link>} /></div>;
}

export function Footer() {
  const { t } = useLocale();
  return <footer className="site-footer"><span data-no-locale>AgentForge</span> <span><span className="dim">/</span> {t('common.footerTagline')}</span><span>{t('common.footerCommunity')}</span></footer>;
}
