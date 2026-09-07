/** Pure responsive view-state helpers for the Agent Builder UI. */

export const AGENT_BUILDER_PANELS = ['canvas', 'configure', 'run', 'preview'] as const;
export type AgentBuilderPanel = (typeof AGENT_BUILDER_PANELS)[number];
export type AgentBuilderLayout = 'desktop' | 'mobile';

export const AGENT_BUILDER_MOBILE_BREAKPOINT = 760;

export function agentBuilderLayoutForWidth(width: number): AgentBuilderLayout {
  return Number.isFinite(width) && width <= AGENT_BUILDER_MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
}

export function agentBuilderPanelForWidth(width: number, requested: string): AgentBuilderPanel {
  if (AGENT_BUILDER_PANELS.includes(requested as AgentBuilderPanel)) return requested as AgentBuilderPanel;
  return 'canvas';
}

export function agentBuilderPanelLabel(panel: AgentBuilderPanel): string {
  return {
    canvas: 'Canvas',
    configure: 'Configure',
    run: 'Run status',
    preview: 'Preview',
  }[panel];
}
