/**
 * Extended types reflecting the pending backend migration:
 * - ApiSecretResponse now includes priority and model_override
 * - LLMConfig / purpose-binding layer removed
 *
 * Once the backend regenerates api-types.gen.ts, these extensions
 * can be removed and components can use the generated types directly.
 */
import type { components } from "../api-types.gen";

/** ApiSecretResponse with the new priority and model_override fields. */
export type ApiSecretResponse = Omit<
	components["schemas"]["ApiSecretResponse"],
	"config_count"
> & {
	priority: number;
	model_override: string | null;
};

/** Re-export for convenience. */
export type FallbackStateResponse =
	components["schemas"]["FallbackStateResponse"];
export type TestAllResultsResponse =
	components["schemas"]["TestAllResultsResponse"];
export type TestResultItem = components["schemas"]["TestResultItem"];
export type ApiSecretCreate = components["schemas"]["ApiSecretCreate"] & {
	priority?: number;
	model_override?: string | null;
};
export type ApiSecretUpdate = components["schemas"]["ApiSecretUpdate"] & {
	priority?: number;
	model_override?: string | null;
};
export type SecretCreateResponse =
	components["schemas"]["SecretCreateResponse"];
export type OkResponse = components["schemas"]["OkResponse"];
export type HealthCheckItem = components["schemas"]["HealthCheckItem"];
