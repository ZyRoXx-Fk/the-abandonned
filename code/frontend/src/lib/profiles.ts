import type { Locale } from '../i18n';

export type Role = 'client' | 'business';
export type AuthAction = 'login' | 'register';

const clientUrl = import.meta.env.PUBLIC_MCP_CLIENT_URL?.trim() || '';
const businessUrl = import.meta.env.PUBLIC_MCP_BUSINESS_URL?.trim() || '';

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

export function installationPrompt(role: Role, locale: Locale = 'en') {
	const profile = profiles[role];
	if (locale === 'en') {
		return `Help me connect the relay MCP server for my ${role} space to my AI assistant.\n\nMCP server URL: ${profile.url || profile.placeholder}\nProfile: ${profile.label}\n\n${profile.url ? '' : 'The address in square brackets is a placeholder. Ask me for the real URL before continuing.\n\n'}First, ask which AI assistant or MCP client I use and on which operating system. Check that it supports the server’s transport, then guide me through the appropriate setup. If automatic installation is not possible, provide manual steps. Do not replace my existing connections. Ask for my permission before making any changes and use the server’s authentication flow without asking me to paste a password or secret into the conversation. Finish by checking the connection and listing the available tools.`;
	}
	return `Aide-moi à connecter le serveur MCP relay pour ${profile.purpose} à mon assistant IA.\n\nAdresse du serveur MCP : ${profile.url || profile.placeholder}\nProfil : ${profile.label}\n\n${profile.url ? '' : 'L’adresse entre crochets est un emplacement à compléter. Demande-moi l’URL réelle avant de continuer.\n\n'}Commence par me demander quel assistant ou client MCP j’utilise et sur quel système. Vérifie qu’il prend en charge le transport du serveur, puis guide-moi dans la configuration adaptée. Si l’installation automatique n’est pas possible, donne-moi les étapes manuelles. Ne remplace pas mes connexions existantes. Demande mon accord avant toute modification et utilise le parcours d’authentification du serveur sans me demander de coller un mot de passe ou un secret dans la conversation. Termine par une vérification de la connexion et la liste des outils disponibles.`;
}
