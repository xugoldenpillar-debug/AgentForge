import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'AgentForge | Build AI. Beat Problems.',description:'Build prompts, skills, tools and agents. Challenge real-world problems. Make AI better together.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
