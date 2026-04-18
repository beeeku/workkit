import { ServiceUnavailableError } from "@workkit/errors";
import type { AiInput, AiOutput, CustomProviderConfig } from "../types";

export async function executeCustom(
	providerName: string,
	providerConfig: CustomProviderConfig,
	model: string,
	input: AiInput,
): Promise<AiOutput> {
	try {
		return await providerConfig.run(model, input);
	} catch (err) {
		throw new ServiceUnavailableError(`custom provider "${providerName}"`, {
			cause: err,
			context: { provider: providerName, model },
		});
	}
}
