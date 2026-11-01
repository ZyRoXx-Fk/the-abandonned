import { buildInstallationPrompt, DEFAULT_MCP_URL } from './connection-prompts.ts';
import { createPairingRequester } from './pairing-api.ts';
import type { Locale } from '../i18n';

export type Role = 'client' | 'business';
export type AuthAction = 'login' | 'register';

const clientUrl = import.meta.env.PUBLIC_MCP_CLIENT_URL?.trim() || DEFAULT_MCP_URL;
const businessUrl = import.meta.env.PUBLIC_MCP_BUSINESS_URL?.trim() || DEFAULT_MCP_URL;

export const profiles = {
	client: {
		label: 'Client',
		url: clientUrl,
		placeholder: '[URL_MCP_CLIENT]',
		purpose: 'mon espace client',
	},
	business: {
		label: 'Business',
		url: businessUrl,
		placeholder: '[URL_MCP_BUSINESS]',
		purpose: 'mon espace business',
	},
} as const;

export function installationPrompt(role: Role, locale: Locale = 'en'): string {
 return buildInstallationPrompt(role, locale, profiles[role].url);
}

// Astro environment stays at this adapter boundary; prompt/API cores are Node-testable.
export const requestPairingCode = createPairingRequester(
 (...args) => fetch(...args),
 (import.meta.env.PUBLIC_API_BASE_URL?.trim() || 'http://localhost:3000').replace(/\/$/, ''),
);
export { pairingPrompt } from './connection-prompts.ts';
