import type { Role } from './profiles.ts';
import type { Locale } from '../i18n/index.ts';

export const DEFAULT_MCP_URL = 'https://relay-backend-latest.onrender.com/mcp';
export const AGENT_SETUP_GUIDE_URL = 'https://raw.githubusercontent.com/ZyRoXx-Fk/the-abandonned/main/agent-setup/prompt.md';

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
	const address = url.trim() || DEFAULT_MCP_URL;
	const serverPrompt = role === 'business' ? 'owner_onboarding' : 'customer_assistance';
	if (locale === 'fr') return `Avant de commencer, explique que j’aurai besoin de donner une validation finale avant toute publication ou confirmation. Réponds en français.\n\nAide-moi à connecter relay pour le rôle ${backendRole(role)}. Lis le guide public d’installation :\n${AGENT_SETUP_GUIDE_URL}\nAdresse du serveur MCP : ${address}\nTransport : Streamable HTTP. Cette adresse est prioritaire sur l’adresse de démonstration du guide. Si tu ne peux pas lire le guide, demande-moi de coller son contenu ; n’invente pas les étapes.\n\nDemande quel assistant/client MCP et système j’utilise, vérifie le transport, et demande mon accord avant toute installation ou modification. Préserve mes connexions existantes. Si nécessaire, donne les étapes de configuration manuelle. Vérifie la connexion et liste les outils réellement disponibles. L’authentification se fait sur le site de confiance ; ne demande jamais de mots de passe, JWT ou identifiants de paiement dans la conversation.\n\nAprès la connexion, guide-moi pour générer mon code privé temporaire sur le site relay de confiance ; si son URL est inconnue, demande-la-moi. Attends ce code avant d’appeler link_session sur cette même connexion, puis vérifie que le rôle renvoyé est ${backendRole(role)}. Ne place jamais ce code dans un fichier de configuration ou une commande. Une fois le compte associé, utilise le prompt ${serverPrompt} s’il est disponible. Distingue configuration, connexion et compte associé ; ne prétends pas qu’une étape a réussi sans vérification.\n\n${workflow(role, locale)} Toute proposition modifiée ou expirée exige une nouvelle validation. Aucun paiement réel ni certification d’identité.`;
	return `Before starting, explain that I will need to give final validation before any publication or confirmation. Respond in English.\n\nHelp me connect relay for role ${backendRole(role)}. Read the public setup guide:\n${AGENT_SETUP_GUIDE_URL}\nMCP server URL: ${address}\nTransport: Streamable HTTP. This address takes precedence over the guide’s demo address. If you cannot read the guide, ask me to paste its contents; do not invent setup steps.\n\nAsk which AI assistant/MCP client and operating system I use, check transport support, and ask for permission before installation or changes. Preserve my existing connections. Provide manual setup steps when needed. Check the connection and list actually available tools. Authentication belongs on the trusted website; never ask for passwords, JWTs or payment credentials in the conversation.\n\nAfter connecting, guide me to generate my temporary private code on the trusted relay website; ask me for its URL if unknown. Wait for that code before calling link_session on this same connection, then verify the returned role is ${backendRole(role)}. Never put the code in a configuration file or shell command. Once paired, use the ${serverPrompt} prompt if available. Distinguish configured, connected and paired; do not claim success without verification.\n\n${workflow(role, locale)} Changed or expired proposals require fresh approval. No real payment or identity certification.`;
}

export function pairingPrompt(role: Role, locale: Locale, token: string): string {
	const code = parsePairingToken(token);
	if (locale === 'fr') return `Avant de commencer, explique que j’aurai besoin de donner une validation finale avant toute publication ou confirmation.\nConnecte mon compte ${backendRole(role)} avec link_session({"token":"${code}"}). Ce code temporaire est réservé à cet assistant ; s’il est expiré, demande un nouveau code sur le site. Ne demande jamais de mots de passe, JWT ou identifiants de paiement.\n${workflow(role, locale)} Toute proposition expire après 15 minutes ; un changement exige une nouvelle validation. Aucun paiement réel ni certification d’identité.`;
	return `Before starting, explain that I will need to give final validation before any publication or confirmation.\nConnect my ${backendRole(role)} account with link_session({"token":"${code}"}). This temporary code is only for this assistant; if expired, ask for a new code from the website. Never ask for passwords, JWTs or payment credentials.\n${workflow(role, locale)} Proposals expire after 15 minutes; changes require fresh approval. No real payment or identity certification.`;
}
