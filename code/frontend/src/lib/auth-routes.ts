import type { Locale } from '../i18n';

export function getAuthPaths(locale: Locale) {
	return (['client', 'business'] as const).flatMap((role) =>
		(['login', 'register'] as const).map((action) => ({
			params: { role, action },
			props: { role, action, locale },
		})),
	);
}
