import { getRelativeLocaleUrl } from 'astro:i18n';
import { messages } from './messages';

export const locales = ['en', 'fr'] as const;
export type Locale = typeof locales[number];
export const defaultLocale: Locale = 'en';

export function localeFromPath(pathname: string): Locale {
	return locales.find((locale) => locale === pathname.split('/')[1]) ?? defaultLocale;
}

export function unlocalizedPath(pathname: string): string {
	const segments = pathname.split('/').filter(Boolean);
	if (locales.some((locale) => locale === segments[0])) segments.shift();
	return segments.length ? `/${segments.join('/')}/` : '/';
}

export function localizedPath(locale: Locale, pathname = '/'): string {
	const path = unlocalizedPath(pathname).replace(/^\/|\/$/g, '');
	const url = getRelativeLocaleUrl(locale, path);
	return url.endsWith('/') ? url : `${url}/`;
}

export function translations(locale: Locale) {
	return messages[locale];
}
