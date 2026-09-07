import { z } from 'zod';
import { validateBuildEnvelope, privateAgentDraft } from './agent-drafts.ts';
import { AppError, ERROR_CODES } from '../shared/errors.ts';

const id = z.string().min(1).max(160);
const short = z.string().min(1).max(160);
const revision = z.number().int().min(1).max(2_147_483_647);
const idempotencyKey = z.string().min(1).max(200);
const definition = z.object({ definition: z.unknown() }).strict();
const draftUpdate = z.object({ expectedRevision: revision, definition: z.unknown() }).strict();
const freeze = z.object({ expectedRevision: revision }).strict();
const publicationRequest = z.object({
  componentVersionId: id,
  publicExampleIds: z.array(id).max(20).optional(),
  publicReferencePaths: z.array(z.string().min(1).max(240)).max(20).optional(),
  declaration: z.string().min(1).max(4_000),
}).strict();
const publicationReview = z.object({
  expectedStatus: z.enum(['submitted', 'in_review', 'approved', 'rejected', 'withdrawn']),
  expectedRevision: revision,
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().min(4).max(4_000),
  checks: z.array(short).max(32).optional(),
}).strict();

const schemas: Record<string, z.ZodType> = {

  providers: z.object({ name: z.string().min(1).max(60), baseUrl: z.url().max(300), modelId: short, apiKey: z.string().min(16).max(512), inputPrice: z.number().min(0).max(10000).nullable().optional(), outputPrice: z.number().min(0).max(10000).nullable().optional() }).strict(),
  runs: z.object({ buildId: id, kind: z.enum(['public', 'hidden']), consent: z.boolean().optional(), mode: z.literal('legacy-stream').optional() }).strict(),
  'runs/async': z.object({ buildId: id, kind: z.enum(['public', 'hidden']), consent: z.boolean().optional(), idempotencyKey }).strict(),
  'evaluation-jobs': z.object({ buildId: id, kind: z.enum(['public', 'hidden']), consent: z.boolean().optional(), idempotencyKey }).strict(),
  'evaluation-jobs/:id/cancel': z.object({ reason: z.literal('user-requested').optional() }).strict(),
  'failure-cases': z.object({ problemId: id, input: z.string().min(1).max(4000), reason: z.string().min(8).max(1000), providerId: id, consent: z.boolean().optional() }).strict(),
  problems: z.object({ title: z.string().min(5).max(100), description: z.string().min(20).max(3000), why: z.string().min(10).max(2000), exampleInput: z.string().min(1).max(4000), expectedOutput: z.string().min(1).max(4000), category: z.string().min(1).max(60) }).strict(),
  'pi-self-test': z.object({ intent: z.enum(['apply', 'run']), prompt: z.string().min(1).max(2000).optional(), credentialId: z.string().min(1).max(100).optional(), consent: z.boolean().optional() }).strict(),
  components: definition,
  'components/:id': draftUpdate,
  'components/:id/draft': draftUpdate,
  'components/:id/versions': freeze,
  'publication-requests': publicationRequest,
  'admin/publication-requests/:id/reviews': publicationReview,
};

function schemaFor(path: string): z.ZodType | undefined {
  const normalizedPath = path.replace(/^evaluation-jobs\/[^/]+\/cancel$/, 'evaluation-jobs/:id/cancel');
  if (schemas[normalizedPath]) return schemas[normalizedPath];
  const parts = normalizedPath.split('/');
  if (parts.length === 2 && parts[0] === 'components') return schemas['components/:id'];
  if (parts.length === 3 && parts[0] === 'components' && parts[2] === 'draft') return schemas['components/:id/draft'];
  if (parts.length === 3 && parts[0] === 'components' && parts[2] === 'versions') return schemas['components/:id/versions'];
  if (parts.length === 4 && parts[0] === 'admin' && parts[1] === 'publication-requests' && parts[3] === 'reviews') return schemas['admin/publication-requests/:id/reviews'];
  return undefined;
}

export function validateBody(path: string, body: Record<string, unknown>): void {
  if (path === 'builds') {
    const mode = validateBuildEnvelope(body);
    if (mode === 'agent') privateAgentDraft(body.agentDefinition, body.visibility);
    else if (!z.object({ nodes: z.array(z.unknown()).min(3).max(24), edges: z.array(z.unknown()).max(64) }).strict().safeParse(body.workflow).success) {
      throw new AppError('Invalid workflow.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    }
    return;
  }
  const schema = schemaFor(path);
  if (schema && !schema.safeParse(body).success) {
    throw new AppError('Invalid request fields. Check the form values and length limits.', 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  }
}
