import { starterWorkflow } from '../../src/shared/catalog.ts';

export function testWorkflow(judge: Parameters<typeof starterWorkflow>[0]) {
  const workflow = starterWorkflow(judge);
  for (const node of workflow.nodes.filter(node => node.kind === 'model')) {
    node.config.credentialId = 'demo';
    node.config.modelId = 'demo-forge';
  }
  return workflow;
}
