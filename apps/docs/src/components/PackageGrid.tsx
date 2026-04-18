const packages = [
	{ name: "types", desc: "Shared TypeScript types", icon: "📐" },
	{ name: "errors", desc: "Structured retry classes", icon: "⚠️" },
	{ name: "env", desc: "Type-safe env validation", icon: "🔐" },
	{ name: "kv", desc: "Typed KV with serialization", icon: "📦" },
	{ name: "d1", desc: "Query builder & migrations", icon: "🗄️" },
	{ name: "r2", desc: "Streaming & presigned URLs", icon: "☁️" },
	{ name: "cache", desc: "SWR & tagged invalidation", icon: "⚡" },
	{ name: "queue", desc: "Typed producer/consumer", icon: "📨" },
	{ name: "do", desc: "State machines & alarms", icon: "🤖" },
	{ name: "cron", desc: "Declarative task routing", icon: "⏰" },
	{ name: "ratelimit", desc: "Fixed, sliding & token bucket", icon: "🚦" },
	{ name: "crypto", desc: "AES-256-GCM & hashing", icon: "🔑" },
	{ name: "ai", desc: "Workers AI with streaming", icon: "🧠" },
	{ name: "ai-gateway", desc: "Multi-provider routing", icon: "🌐" },
	{ name: "agent", desc: "Tool loops, handoffs, hooks", icon: "🤝" },
	{ name: "memory", desc: "Edge-native agent memory", icon: "🧬" },
	{ name: "mcp", desc: "MCP servers + REST + OpenAPI", icon: "🛠️" },
	{ name: "workflow", desc: "Durable execution & saga", icon: "🪢" },
	{ name: "approval", desc: "Policies, tokens, audit", icon: "✋" },
	{ name: "notify", desc: "Email, in-app, WhatsApp", icon: "🔔" },
	{ name: "mail", desc: "Send, receive, route, parse", icon: "✉️" },
	{ name: "chat", desc: "Real-time chat over WebSockets", icon: "💬" },
	{ name: "browser", desc: "Browser Rendering primitive", icon: "🪟" },
	{ name: "pdf", desc: "HTML → PDF via Browser Rendering", icon: "📄" },
	{ name: "turnstile", desc: "Server-side CAPTCHA verify", icon: "🛂" },
	{ name: "features", desc: "KV-backed feature flags", icon: "🎚️" },
	{ name: "health", desc: "Binding health probes", icon: "❤️‍🩹" },
	{ name: "api", desc: "OpenAPI generation", icon: "📋" },
	{ name: "auth", desc: "JWT & session management", icon: "🛡️" },
	{ name: "logger", desc: "Structured JSON logging", icon: "📝" },
	{ name: "testing", desc: "In-memory binding mocks", icon: "🧪" },
	{ name: "cli", desc: "Scaffolding & code generation", icon: "⌨️" },
];

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, "/");

export default function PackageGrid() {
	return (
		<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
			{packages.map((pkg) => (
				<a
					key={pkg.name}
					href={`${BASE}api-reference#workkit${pkg.name}`}
					className="group rounded-lg border border-slate-800 bg-slate-900/50 p-4 hover:border-sky-400/50 hover:bg-slate-900 transition-all"
				>
					<div className="text-2xl mb-2">{pkg.icon}</div>
					<div className="font-mono text-sm text-sky-400">@workkit/{pkg.name}</div>
					<div className="text-xs text-slate-400 mt-1">{pkg.desc}</div>
				</a>
			))}
		</div>
	);
}
