import type { Role } from './profiles.ts';
import type { Locale } from '../i18n/index.ts';

export const backendRole = (role: Role): 'owner' | 'client' => role === 'business' ? 'owner' : 'client';

export function parsePairingToken(token: string): string {
	if (typeof token !== 'string' || !/^TRUST-[a-f0-9]{32}$/.test(token)) throw new Error('Invalid pairing code');
	return token;
}

function workflow(role: Role, locale: Locale): string {
	if (locale === 'fr') return role === 'business'
		? 'Accompagne le propriétaire (owner) pour restaurant, hôtel ou boutique : prépare un brouillon, demande les informations manquantes et les prix finaux, présente la prévisualisation puis demande un accord explicite avant la publication. La publication ne certifie pas indépendamment son identité.'
		: 'Accompagne le client (client) : recherche les établissements publiés, prépare une commande à retirer ou une réservation restaurant/hôtel. Présente les disponibilités, conditions et prix finaux du serveur, puis demande un accord explicite avant confirmation. Pour une modification de réservation, prépare une nouvelle proposition à valider ; pas de modification de commande. Aucun paiement réel n’est collecté.';
	return role === 'business'
		? 'Guide the owner through restaurant, hotel or shop onboarding: prepare a draft, ask for missing facts and final prices, show the preview for review, then request explicit approval before publication. Publication is not independent identity certification.'
		: 'Guide the client through published business discovery, pickup-only orders and restaurant/hotel reservations. Show server availability, terms and final prices, then request explicit approval before confirmation. For a reservation amendment, prepare a new proposal for approval; no order amendments. No real payment is collected.';
}

export function buildInstallationPrompt(role: Role, locale: Locale, url: string): string {
	const address = url || (role === 'business' ? '[URL_MCP_BUSINESS]' : '[URL_MCP_CLIENT]');
	if (locale === 'fr') return `Avant de commencer, explique que j’aurai besoin de donner une validation finale avant toute publication ou confirmation.\n\nAide-moi à connecter le serveur MCP relay pour le rôle ${backendRole(role)}.\nAdresse du serveur MCP : ${address}\n${url ? '' : 'Cette adresse est un emplacement à compléter : demande-moi l’URL réelle avant de continuer.\n'}Demande quel assistant/client MCP et système j’utilise, vérifie le transport, et demande mon accord avant toute installation ou modification. Préserve mes connexions existantes. Si nécessaire, donne les étapes de configuration manuelle. Vérifie la connexion et liste les outils. L’authentification se fait sur le site de confiance ; ne demande jamais de mots de passe, JWT ou identifiants de paiement dans la conversation.\n\n${workflow(role, locale)} Toute proposition modifiée ou expirée exige une nouvelle validation. Aucun paiement réel ni certification d’identité.`;
	return `Before starting, explain that I will need to give final validation before any publication or confirmation.\n\nHelp me connect the relay MCP server for role ${backendRole(role)}.\nMCP server URL: ${address}\n${url ? '' : 'This address is a placeholder: ask me for the real URL before continuing.\n'}Ask which AI assistant/MCP client and operating system I use, check transport support, and ask for permission before installation or changes. Preserve my existing connections. Provide manual setup steps when needed. Check the connection and list available tools. Authentication belongs on the trusted website; never ask for passwords, JWTs or payment credentials in the conversation.\n\n${workflow(role, locale)} Changed or expired proposals require fresh approval. No real payment or identity certification.`;
}

export function pairingPrompt(role: Role, locale: Locale, token: string): string {
	const code = parsePairingToken(token);
	if (locale === 'fr') return `Avant de commencer, explique que j’aurai besoin de donner une validation finale avant toute publication ou confirmation.\nConnecte mon compte ${backendRole(role)} avec link_session({"token":"${code}"}). Ce code temporaire est réservé à cet assistant ; s’il est expiré, demande un nouveau code sur le site. Ne demande jamais de mots de passe, JWT ou identifiants de paiement.\n${workflow(role, locale)} Toute proposition expire après 15 minutes ; un changement exige une nouvelle validation. Aucun paiement réel ni certification d’identité.`;
	return `Before starting, explain that I will need to give final validation before any publication or confirmation.\nConnect my ${backendRole(role)} account with link_session({"token":"${code}"}). This temporary code is only for this assistant; if expired, ask for a new code from the website. Never ask for passwords, JWTs or payment credentials.\n${workflow(role, locale)} Proposals expire after 15 minutes; changes require fresh approval. No real payment or identity certification.`;
}
