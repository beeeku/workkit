import CodeExample from './CodeExample';
import PackageGrid from './PackageGrid';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-950">
      {/* Nav */}
      <nav className="flex items-center justify-between max-w-6xl mx-auto px-6 py-5">
        <a href={BASE} className="font-mono font-bold text-xl text-white tracking-tight">
          workkit
        </a>
        <div className="flex items-center gap-6 text-sm">
          <a href={`${BASE}getting-started`} className="text-slate-400 hover:text-white transition-colors">
            Docs
          </a>
          <a href={`${BASE}guides/env-validation`} className="text-slate-400 hover:text-white transition-colors">
            Guides
          </a>
          <a href={`${BASE}api-reference`} className="text-slate-400 hover:text-white transition-colors">
            API
          </a>
          <a
            href="https://github.com/beeeku/workkit"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/50 px-4 py-1.5 text-xs text-slate-400 mb-8">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          v0.1.0 — now in public beta
        </div>

        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-tight">
          <span className="bg-gradient-to-r from-sky-400 via-cyan-300 to-teal-400 bg-clip-text text-transparent">
            Composable utilities
          </span>
          <br />
          <span className="text-white">for Cloudflare Workers</span>
        </h1>

        <p className="mt-6 text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Type-safe, composable utilities for every Cloudflare Workers binding.
          KV, D1, R2, Queues, Durable Objects, AI — all with consistent APIs and zero runtime overhead.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href={`${BASE}getting-started`}
            className="rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold px-7 py-3 text-sm transition-colors"
          >
            Get Started
          </a>
          <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-5 py-3">
            <code className="text-sm font-mono text-slate-300">bunx workkit init</code>
            <button
              onClick={() => navigator.clipboard.writeText('bunx workkit init')}
              className="text-slate-500 hover:text-sky-400 transition-colors"
              title="Copy to clipboard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* Code Example */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-white mb-2">Less boilerplate. More types.</h2>
        <p className="text-slate-400 mb-8">
          See the difference between raw Cloudflare APIs and workkit's composable utilities.
        </p>
        <CodeExample />
      </section>

      {/* Package Grid */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-2xl font-bold text-white mb-2">18 packages. One ecosystem.</h2>
        <p className="text-slate-400 mb-8">
          Install only what you need. Every package works standalone or composes with others.
        </p>
        <PackageGrid />
      </section>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-slate-800">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div>MIT License</div>
          <div>
            Built by{' '}
            <a
              href="https://github.com/beeeku"
              className="text-slate-400 hover:text-white transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Bikash Dash
            </a>
          </div>
          <div className="font-mono text-xs text-slate-600">built with workkit</div>
        </div>
      </footer>
    </div>
  );
}
