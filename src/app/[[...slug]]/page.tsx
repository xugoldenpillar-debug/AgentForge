import { Suspense } from 'react';
import { ArenaApp } from '@/components/arena-app';

function AppFallback() {
  return (
    <div className="loading-state" aria-label="AgentForge">
      <div className="flex items-center gap-2">
        <span className="spinner" />
        <span>Agent<span className="accent">Forge</span></span>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<AppFallback />}>
      <ArenaApp />
    </Suspense>
  );
}
