import { ToastProvider } from '@/components/common';
import { AgentBuilderPage } from '@/features/builder/agent-builder-page';

export default function AgentBuilderRoute() {
  return (
    <ToastProvider>
      <AgentBuilderPage />
    </ToastProvider>
  );
}
