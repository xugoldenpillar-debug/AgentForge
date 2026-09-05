'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="container page"><div className="eyebrow">RECOVERABLE ERROR</div><h1>The forge hit a snag.</h1><p className="muted mt-3">Please retry. No provider credentials are included in this message.</p><button className="button primary mt-3" onClick={reset}>Retry</button></main>;}
