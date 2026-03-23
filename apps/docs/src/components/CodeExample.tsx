import { useState } from "react";

const workkitCode = `import { parseEnvSync } from "@workkit/env"
import { kv } from "@workkit/kv"
import { z } from "zod"

const env = parseEnvSync(rawEnv, {
  API_KEY: z.string().min(1),
  CACHE: z.any(),
})

const cache = kv<User>(env.CACHE, {
  prefix: "user:",
  defaultTtl: 3600,
})

const user = await cache.get("alice")
// ^? User | null — fully typed`;

const rawCode = `export default {
  async fetch(request, env) {
    const apiKey = env.API_KEY;
    const raw = await env.CACHE.get("user:alice");
    let user;
    try {
      user = raw ? JSON.parse(raw) : null;
    } catch {
      user = null;
    }
    return new Response(JSON.stringify(user));
  }
}`;

export default function CodeExample() {
	const [tab, setTab] = useState<"workkit" | "raw">("workkit");

	return (
		<div className="rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden">
			<div className="flex border-b border-slate-800">
				<button
					type="button"
					onClick={() => setTab("workkit")}
					className={`px-5 py-3 text-sm font-medium transition-colors ${
						tab === "workkit"
							? "text-sky-400 border-b-2 border-sky-400 bg-slate-900/50"
							: "text-slate-500 hover:text-slate-300"
					}`}
				>
					with workkit
				</button>
				<button
					type="button"
					onClick={() => setTab("raw")}
					className={`px-5 py-3 text-sm font-medium transition-colors ${
						tab === "raw"
							? "text-orange-400 border-b-2 border-orange-400 bg-slate-900/50"
							: "text-slate-500 hover:text-slate-300"
					}`}
				>
					raw Cloudflare
				</button>
			</div>
			<pre className="p-6 overflow-x-auto">
				<code className="text-sm font-mono leading-relaxed text-slate-300">
					{tab === "workkit" ? workkitCode : rawCode}
				</code>
			</pre>
		</div>
	);
}
