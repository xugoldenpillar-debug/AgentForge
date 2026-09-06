import type { Metadata } from 'next';
import './globals.css';
import { browserBootstrapScript } from '@/shared/i18n/locale';
import { LocaleProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'AgentForge | Build AI. Beat Problems.',
  description: 'Build prompts, skills, tools and agents. Challenge real-world problems. Make AI better together.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-display-language="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: browserBootstrapScript() }} />
      </head>
      <body><LocaleProvider>{children}</LocaleProvider></body>
    </html>
  );
}
