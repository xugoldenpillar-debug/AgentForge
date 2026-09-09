import Link from 'next/link';
import { ToastProvider } from '@/components/common';
import { AgentBuilderPage } from '@/features/builder/agent-builder-page';

export default function AgentBuilderRoute() {
  return (
    <ToastProvider>
      <div style={{ padding: '10px 18px', borderBottom: '1px solid #e5e7eb', background: '#fff', textAlign: 'right' }}>
        <Link href="/official-api-gallery" style={{ color: 'inherit', textUnderlineOffset: 3 }}>
          Official API Gallery · 看同一官方 API 的作品 →
        </Link>
      </div>
      <AgentBuilderPage />
    </ToastProvider>
  );
}
