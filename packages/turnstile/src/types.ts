export interface TurnstileVerifyOptions {
	remoteIp?: string;
	idempotencyKey?: string;
	expectedAction?: string;
	timeout?: number;
}

export interface TurnstileResult {
	success: boolean;
	challengeTs: string;
	hostname: string;
	errorCodes: string[];
	action?: string;
	cdata?: string;
}

export interface TurnstileMiddlewareOptions {
	secretKey: string;
	headerName?: string;
	fieldName?: string;
	remoteIpHeader?: string;
	expectedAction?: string;
	timeout?: number;
}
