export function generateFactId(): string {
	return `fact_${randomChars(16)}`;
}

export function generateMessageId(): string {
	return `msg_${randomChars(16)}`;
}

export function generateSummaryId(): string {
	return `sum_${randomChars(16)}`;
}

function randomChars(length: number): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

const STOP_WORDS = new Set([
	"a",
	"an",
	"the",
	"is",
	"it",
	"in",
	"on",
	"at",
	"to",
	"for",
	"of",
	"and",
	"or",
	"but",
	"not",
	"with",
	"by",
	"from",
	"as",
	"this",
	"that",
	"what",
	"which",
	"who",
	"how",
	"when",
	"where",
	"do",
	"does",
	"did",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"i",
	"you",
	"he",
	"she",
	"we",
	"they",
	"my",
	"your",
	"his",
	"her",
	"its",
	"our",
	"their",
	"me",
	"him",
	"us",
	"them",
]);

export function extractSearchTerms(query: string): string[] {
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const ai = a[i]!;
		const bi = b[i]!;
		dot += ai * bi;
		normA += ai * ai;
		normB += bi * bi;
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}
