'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getInitialLanguage, isDisplayLanguage, persistLanguage, syncDocumentLanguage } from '@/shared/i18n/locale';
import { DEFAULT_LANGUAGE, type DisplayLanguage, type MessageKey, type MessageParams } from '@/shared/i18n/types';
import { translate } from './translate';
import { formatDate, formatDuration, formatMoney, formatNumber, formatPercent } from './format';

type LocaleContextValue = {
  language: DisplayLanguage;
  setLanguage: (language: DisplayLanguage) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
  formatNumber: (value: number) => string;
  formatPercent: (value: number) => string;
  formatMoney: (value: number | null | undefined) => string;
  formatDate: (value: string | Date) => string;
  formatDuration: (value: number) => string;
  tx: (text: string, params?: MessageParams) => string;
};


const LEGACY_KEY_BY_TEXT: Partial<Record<string, MessageKey>> = {
  'Language': 'language.label', 'English': 'language.english', 'Simplified Chinese': 'language.simplifiedChinese',
  'Arena': 'navigation.arena', 'Challenges': 'navigation.challenges', 'Leaderboards': 'navigation.leaderboards', 'Workshop': 'navigation.workshop',
  'Provider settings': 'navigation.providerSettings', 'Sign out': 'navigation.signOut', 'Start building': 'navigation.startBuilding', 'Back to the arena': 'navigation.backToArena',
  'View all': 'navigation.viewAll', 'Find a challenge': 'navigation.findChallenge', 'View leaderboard': 'navigation.viewLeaderboard', 'Open Agent Builder': 'navigation.openBuilder',
  'Explore challenges': 'navigation.exploreChallenges', 'Explore the workshop': 'navigation.exploreWorkshop', 'Join the fight': 'navigation.joinChallenge', 'Manage encrypted credentials': 'navigation.manageCredentials',
  'LOCAL SEASON 01': 'header.localSeason', BETA: 'common.beta', 'Loading the arena...': 'common.loadingArena', 'Try again': 'common.tryAgain', 'Best score': 'common.bestScore', Builders: 'common.builders', 'Solve rate': 'common.solveRate', tokens: 'common.tokens', tools: 'common.tools', Reward: 'common.reward', 'Current best': 'common.currentBest', 'Community solve rate': 'common.communitySolveRate', 'demo lane': 'common.demoLane', 'Contract passed': 'common.contractPassed', Simulated: 'common.simulated', Estimated: 'common.estimated', 'Total energy': 'common.totalEnergy', 'Summed execution time': 'common.executionTime', INPUT: 'common.input', EXPECTED: 'common.expected', ACTUAL: 'common.actual', PASS: 'common.pass', FAIL: 'common.fail', READY: 'common.ready', PUBLIC: 'common.public', HIDDEN: 'common.hidden', SUBMITTED: 'common.submitted',
  'THE ARENA FOR REAL-WORLD INTELLIGENCE': 'home.eyebrow', 'Build AI.': 'home.titleBuild', 'Beat problems.': 'home.titleProblems', 'No API key? Start in the free simulation lane.': 'home.heroNote', 'One problem. All of us.': 'home.allOfUs', 'Boss briefing': 'home.bossBriefing', 'WORLD BOSS': 'home.worldBoss', 'CO-OP CHALLENGE': 'home.coopChallenge', 'Take the inbox to zero.': 'home.bossTitle', 'Top builders': 'home.topBuilders', 'Latest runs': 'home.latestRuns', 'View profile': 'home.viewProfile',
  'ACTIVE': 'challenges.active', 'Build an agent': 'challenges.buildAgent', 'Create a problem': 'challenges.createProblem', 'All challenges': 'challenges.allChallenges', 'World Boss': 'challenges.worldBoss',
  '01 / MISSION BRIEFING': 'challenge.missionBriefing', 'Win condition': 'challenge.winCondition', 'Use these examples to tune your build before submitting.': 'challenge.examplesHint', "What you can't see is the challenge.": 'challenge.hiddenCasesTitle', 'Hidden cases execute on the server. Your browser receives only aggregate scores and failure categories.': 'challenge.hiddenCasesDescription', 'MISSION CONSTRAINTS': 'challenge.constraints', 'Token budget': 'challenge.tokenBudget', 'Tool calls': 'challenge.toolCalls', 'Cost per case': 'challenge.costPerCase', 'Latency per case': 'challenge.latencyPerCase', 'Reputation tier': 'challenge.reputationTier', 'CURRENT BEST / ALL LANES': 'challenge.currentBestAllLanes', 'Agent builds': 'challenge.agentBuilds', 'DETERMINISTIC SCORING': 'challenge.deterministicScoring', 'Demo / simulated': 'challenge.demoSimulated', 'BYOK / unverified': 'challenge.byokUnverified', 'Platform / verified': 'challenge.platformVerified',
  'Failure Lab': 'failure.title', 'FAILURE DISCOVERED / DEMO': 'failure.eyebrow', 'Adversarial input': 'failure.input', 'Why should this fail?': 'failure.reason', 'Submit counterexample': 'failure.submit', 'Demo engine': 'failure.demoEngine', 'Platform Gateway': 'failure.platformGateway', 'Sign in to hunt failures': 'failure.signIn', 'Hunter rules': 'failure.hunterRules',
  'REUSABLE COMPONENTS': 'workshop.eyebrow', 'Equip': 'workshop.equip', 'REGISTERED TOOL': 'workshop.registeredTool',
  'MODEL ACCESS': 'providers.eyebrow', 'Forge simulation': 'providers.forgeSimulation', 'Platform AI Gateway': 'providers.platformGateway', 'SERVER CONFIGURED': 'providers.serverConfigured', 'SIMULATED / FREE': 'providers.simulatedFree', 'Your engines': 'providers.yourEngines', 'NETWORK ALLOWLIST': 'providers.networkAllowlist', 'Add an OpenAI-compatible provider': 'providers.addProvider', 'Display name': 'providers.displayName', 'Model ID': 'providers.modelId', 'Base URL': 'providers.baseUrl', 'API key': 'providers.apiKey', 'OPTIONAL MODEL PRICING': 'providers.pricing', 'Input USD / 1M tokens': 'providers.inputPricing', 'Output USD / 1M tokens': 'providers.outputPricing', 'Save provider': 'providers.save', 'Saving...': 'providers.saving',
  'Profile': 'profile.title', 'Builds': 'profile.builds', 'Badges': 'profile.badges', 'Reputation': 'profile.reputation', 'No public builds yet.': 'profile.noBuilds', 'No badges yet.': 'profile.noBadges', 'Build': 'build.title', 'View parent build': 'build.parent',
  'Agent Builder': 'builder.title', 'Build name': 'builder.buildName', 'Build visibility': 'builder.visibility', 'Export workflow JSON': 'builder.exportWorkflow', 'Save version': 'builder.saveVersion', 'Run public tests': 'builder.runPublic', 'Submit hidden suite': 'builder.submitHidden', 'COMPONENT PALETTE': 'builder.palette', 'WORKFLOW CANVAS': 'builder.workflowCanvas', 'EXECUTING': 'builder.executing', 'TEST RESULTS': 'builder.testResults', 'EXECUTION TRACE': 'builder.executionTrace', 'ENERGY': 'builder.energy', 'ARENA SCORE': 'builder.arenaScore', 'PRACTICE SCORE': 'builder.practiceScore', Prompt: 'builder.prompt', Reasoning: 'builder.reasoning', 'Visible output': 'builder.visibleOutput', 'Tool calls / all cases': 'builder.toolCallsAllCases', 'Duplicate': 'builder.duplicate', Delete: 'builder.delete', 'Invalid JSON. The last valid schema is still active.': 'builder.invalidJson', 'Output contract': 'builder.outputContract', 'Allowed values (one per line)': 'builder.allowedValues', 'Expression / blank = previous output': 'builder.expression', 'Search query': 'builder.searchQuery', 'Text to match': 'builder.textToMatch', 'System prompt': 'builder.systemPrompt', 'User template': 'builder.userTemplate', 'Node provider': 'builder.nodeProvider', 'Max output tokens': 'builder.maxOutputTokens', Temperature: 'builder.temperature', 'Skill card': 'builder.skillCard', 'Maximum output characters': 'builder.maximumOutputCharacters', 'Registered tool': 'builder.registeredTool', 'JSON Schema': 'builder.jsonSchema', 'Exact enum': 'builder.exactEnum', 'Nonempty text': 'builder.nonemptyText',
  'Copy': 'builder.duplicate', 'The server is judging the hidden suite.': 'builder.hiddenRunHint', 'Your workflow is executing.': 'builder.workflowExecuting', 'Your agent is ready for its first run.': 'builder.agentReady', 'Start with public tests. Tune your prompt. Then challenge the hidden suite.': 'builder.firstRunHint', 'Hidden execution traces stay server-side.': 'builder.hiddenServerOnly', 'Run public tests to watch the agent execute each node.': 'builder.runPublicToWatch',
  'Sign in': 'auth.signIn', 'Create account': 'auth.createAccount', 'Builder name': 'auth.builderName', Email: 'auth.email', Password: 'auth.password', 'OR CONTINUE WITH': 'auth.continueWith', 'Use seeded demo account': 'auth.demoAccount', 'Already a builder?': 'auth.alreadyBuilder', 'New to the arena?': 'auth.newToArena',
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<DisplayLanguage>(() => {
    if (typeof document !== 'undefined') {
      const bootstrapped = document.documentElement.dataset.displayLanguage;
      if (isDisplayLanguage(bootstrapped)) return bootstrapped;
    }
    return DEFAULT_LANGUAGE;
  });
  const setLanguage = useCallback((next: DisplayLanguage) => {
    setLanguageState(next);
    persistLanguage(next, typeof window === 'undefined' ? undefined : window.localStorage);
    syncDocumentLanguage(next, typeof document === 'undefined' ? undefined : document);
  }, []);

  useEffect(() => {
    const initial = getInitialLanguage(navigator.language, window.localStorage);
    setLanguageState(initial);
    syncDocumentLanguage(initial, document);
  }, []);

  useEffect(() => {
    syncDocumentLanguage(language, typeof document === 'undefined' ? undefined : document);
  }, [language]);

  const value = useMemo<LocaleContextValue>(() => ({
    language,
    setLanguage,
    t: (key, params) => translate(language, key, params),
    formatNumber: (value) => formatNumber(value, language),
    formatPercent: (value) => formatPercent(value, language),
    formatMoney: (value) => formatMoney(value, language),
    formatDate: (value) => formatDate(value, language),
    formatDuration: (value) => formatDuration(value, language),
    tx: (text, params) => {
      const key = LEGACY_KEY_BY_TEXT[text];
      return key ? translate(language, key, params) : text;
    },
  }), [language, setLanguage]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider');
  return value;
}
