import { ValidationError } from "@workkit/errors";

export class BodyTooLongError extends ValidationError {
	constructor(actual: number, cap: number) {
		super(`in-app notification body exceeds cap (${actual} > ${cap} chars)`, [
			{ path: ["body"], message: `${actual} chars; cap ${cap}` },
		]);
	}
}

export class UnsafeLinkError extends ValidationError {
	constructor(value: string, reason: string) {
		super(`unsafe deep link rejected: ${reason}`, [
			{ path: ["deepLink"], message: `${reason}: ${value.slice(0, 80)}` },
		]);
	}
}
