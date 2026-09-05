import { Suspense } from 'react';
import { ArenaApp } from '@/components/arena-app';
export default function Page(){return <Suspense fallback={<div style={{padding:40,color:'#c4ef79'}}>Initializing the forge...</div>}><ArenaApp/></Suspense>;}
