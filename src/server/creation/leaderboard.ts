import type { Repository } from '../../shared/types.ts';
import type { PublicCreationProvenance, PublicCreationSkillRef } from '../../shared/creation-provenance.ts';
import { validateConfiguredAgentBuild } from '../../shared/agent-build-contract.ts';
import type { ShowcaseVotingService } from '../voting/service.ts';

type VotingLeaderboardPort = Pick<ShowcaseVotingService, 'projectLeaderboard'>;
type VotingLeaderboard = Awaited<ReturnType<VotingLeaderboardPort['projectLeaderboard']>>;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function skillProjection(value: unknown): PublicCreationSkillRef | null {
  if (!record(value)) return null;
  if (!['componentId', 'versionId', 'contentDigest', 'name', 'description'].every((key) => typeof value[key] === 'string')) return null;
  return {
    componentId: value.componentId as string,
    versionId: value.versionId as string,
    contentDigest: value.contentDigest as string,
    name: value.name as string,
    description: value.description as string,
  };
}

export interface CreationLeaderboardSection {
  readonly key: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly rows: readonly CreationLeaderboardRow[];
}

export interface CreationLeaderboardRow {
  readonly entryId: string;
  readonly publication: VotingLeaderboard['rows'][number]['publication'];
  readonly comparisons: number;
  readonly halfPoints: number;
  readonly points: number;
  readonly score: number;
  readonly validVoters: number;
  readonly qualified: boolean;
  readonly provenance: PublicCreationProvenance | null;
}

export class CreationLeaderboardService {
  readonly #repository: Repository;
  readonly #voting: VotingLeaderboardPort;

  constructor(repository: Repository, voting: VotingLeaderboardPort) {
    this.#repository = repository;
    this.#voting = voting;
  }

  async project(roundId: string, comparatorKey: string, policyVersion: string) {
    const base = await this.#voting.projectLeaderboard(roundId, comparatorKey, policyVersion);
    const rows: CreationLeaderboardRow[] = await Promise.all(base.rows.map(async (row) => ({
      ...row,
      provenance: await this.provenanceForPublication(row.publication.publicationId),
    })));
    const groups = new Map<string, CreationLeaderboardRow[]>();
    for (const row of rows) {
      if (row.provenance?.model.providerClass !== 'official') continue;
      const key = `${row.provenance.model.providerId}:${row.provenance.model.modelId}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const officialSections: CreationLeaderboardSection[] = [...groups.entries()].map(([key, sectionRows]) => ({
      key,
      providerId: sectionRows[0].provenance!.model.providerId,
      modelId: sectionRows[0].provenance!.model.modelId,
      rows: sectionRows,
    })).sort((a, b) => a.key.localeCompare(b.key));
    return { ...base, rows, officialSections };
  }

  async provenanceForPublication(publicationId: string): Promise<PublicCreationProvenance | null> {
    const publication = (await this.#repository.read('workPublications', { id: publicationId, status: 'published' }))[0];
    if (!publication) return null;
    const bundle = (await this.#repository.read('artifactBundles', { id: publication.sourceBundleId }))[0];
    if (!bundle?.creationRunId) return null;
    const run = (await this.#repository.read('creationRuns', { id: bundle.creationRunId }))[0];
    if (!run?.evaluationJobId || !run.challengeVersionId) return null;
    const [job, buildVersion, brief, challengeVersion] = await Promise.all([
      this.#repository.read('evaluationJobs', { id: run.evaluationJobId }).then((rows) => rows[0]),
      this.#repository.read('buildVersions', { id: run.buildVersionId }).then((rows) => rows[0]),
      this.#repository.read('creationBriefVersions', { id: run.briefVersionId }).then((rows) => rows[0]),
      this.#repository.read('animationChallengeVersions', { id: run.challengeVersionId }).then((rows) => rows[0]),
    ]);
    if (!job || !buildVersion || !brief || !challengeVersion) return null;
    const definition = validateConfiguredAgentBuild(buildVersion.agentDefinition, buildVersion.visibility, {
      requireModel: true, requireEnvironment: true, requireOutputContract: true, requireRuntime: true,
    });
    const metadata = job.snapshot.metadata;
    if (!record(metadata)) return null;
    const providerClass = metadata.providerClass === 'official' ? 'official' : metadata.providerClass === 'custom' ? 'custom' : null;
    const providerId = typeof metadata.providerId === 'string' ? metadata.providerId : null;
    const privateProviderHost = typeof metadata.providerHost === 'string' ? metadata.providerHost : null;
    const protocol = typeof metadata.providerProtocol === 'string' ? metadata.providerProtocol : null;
    const modelId = job.snapshot.modelOfferingId;
    if (!providerClass || !providerId || !privateProviderHost || !protocol || !modelId) return null;
    const providerHost = providerClass === 'official' ? privateProviderHost : 'custom';
    const skills = Array.isArray(metadata.skills)
      ? metadata.skills.map(skillProjection).filter((skill): skill is PublicCreationSkillRef => skill !== null)
      : [];
    return {
      schemaVersion: 1,
      challenge: {
        challengeId: challengeVersion.challengeId,
        challengeVersionId: challengeVersion.id,
        title: challengeVersion.title,
        prompt: brief.instructions,
        outputPolicyVersion: challengeVersion.outputPolicyVersion,
      },
      model: { modelId, providerClass, providerId, providerHost, protocol },
      runtime: {
        kind: 'pi',
        adapterVersion: run.context.runtimeSelection.adapterVersion,
        policyVersion: run.context.runtimeSelection.policyVersion,
        systemPromptVersion: typeof metadata.systemPromptVersion === 'string' ? metadata.systemPromptVersion : 'creation-pi-v1',
      },
      skills,
      prompts: {
        agentInstructions: definition.instructions,
        challengeInstructions: brief.instructions,
      },
      capturedAt: job.snapshot.capturedAt,
    };
  }
}
