/**
 * Multi-locale STOP/UNSUBSCRIBE keyword recognition.
 *
 * Caller can extend via `extraStopKeywords: string[]` on the adapter.
 * Matching is case-insensitive, whitespace-trimmed; the body must equal
 * the keyword (no substring matches — "I'd like to stop receiving these"
 * does NOT count).
 */

const DEFAULT_STOP_KEYWORDS: ReadonlyArray<string> = [
	// English
	"stop",
	"stop all",
	"unsubscribe",
	"remove",
	"cancel",
	// Hindi (Devanagari + ASCII transliteration)
	"रोक",
	"बंद",
	"रोकें",
	"रद्द",
	"rok",
	"band",
	// Spanish
	"alto",
	"baja",
	"cancelar",
	// French
	"arrêt",
	"arret",
	"désabonner",
	"desabonner",
];

export interface StopMatchOptions {
	extraKeywords?: ReadonlyArray<string>;
}

export function isStopKeyword(text: string, options: StopMatchOptions = {}): boolean {
	const normalized = text.trim().toLowerCase();
	if (normalized.length === 0) return false;
	const list = [...DEFAULT_STOP_KEYWORDS, ...(options.extraKeywords ?? [])];
	for (const kw of list) {
		if (normalized === kw.toLowerCase()) return true;
	}
	return false;
}

/** Exposed for tests + consumer introspection. */
export function defaultStopKeywords(): ReadonlyArray<string> {
	return DEFAULT_STOP_KEYWORDS;
}
