/**
 * Validate a project name for npm compatibility.
 * Returns an error message string if invalid, undefined if valid.
 */
export function validateProjectName(name: string | undefined): string | undefined {
	if (!name || name.trim().length === 0) return "Project name is required";
	if (name.includes(" ")) return "Project name cannot contain spaces";
	if (name.startsWith(".") || name.startsWith("_")) return "Project name cannot start with . or _";
	return undefined;
}
