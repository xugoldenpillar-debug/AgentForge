import type { Workflow } from '../../shared/workflow-types.ts';

export {
  publicWorkflow,
  topologicalOrder,
  validateSchemaDefinition,
  validateWorkflow
} from '../../shared/workflow-validation.ts';

export function forkWorkflow(w: Workflow): Workflow {
  return {
    ...structuredClone(w),
    nodes: w.nodes.map((n) => ({
      ...structuredClone(n),
      config: n.kind === 'model'
        ? { ...n.config, credentialId: '', modelId: '' }
        : structuredClone(n.config)
    }))
  };
}
