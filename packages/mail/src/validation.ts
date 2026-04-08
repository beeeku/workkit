import { InvalidAddressError } from "./errors";

/**
 * Reasonable email regex — covers real-world addresses without attempting
 * full RFC 5322 compliance. No leading dots, no consecutive dots, requires
 * at least a two-part domain.
 */
const EMAIL_REGEX =
	/^(?!\.)(?!.*\.\.)([a-z0-9_'+\-\.]*)[a-z0-9_'+\-]@([a-z0-9][a-z0-9\-]*\.)+[a-z]{2,}$/i;

/** Check if a string is a valid email address */
export function isValidAddress(address: string): boolean {
	return EMAIL_REGEX.test(address);
}

/** Validate and normalize an email address. Throws InvalidAddressError if invalid. */
export function validateAddress(address: string): string {
	const trimmed = address.trim();
	if (!isValidAddress(trimmed)) {
		throw new InvalidAddressError(trimmed || "(empty)");
	}
	return trimmed;
}
