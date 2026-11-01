import { requestPairingCode } from '../lib/profiles';
import { backendRole, pairingPrompt } from '../lib/connection-prompts.ts';
import { PairingApiError } from '../lib/pairing-api.ts';
import type { AccountProfile } from '../lib/auth-api';
import type { Role } from '../lib/profiles';
import type { Locale } from '../i18n';
import type { Messages } from '../i18n/messages';

export function initializePairingPanel(panel: HTMLElement): {reset(): void; destroy(): void} {
	const generate = panel.querySelector<HTMLButtonElement>('[data-pairing-generate]')!;
	const copy = panel.querySelector<HTMLButtonElement>('[data-pairing-copy]')!;
	const prompt = panel.querySelector<HTMLTextAreaElement>('[data-pairing-prompt]')!;
	const result = panel.querySelector<HTMLElement>('[data-pairing-result]')!;
	const status = panel.querySelector<HTMLElement>('[data-pairing-status]')!;
	const expiry = panel.querySelector<HTMLTimeElement>('[data-pairing-expiry]')!;
	const ui: Messages['pairing'] = JSON.parse(panel.dataset.messages!);
	const role = panel.dataset.role as Role;
	const locale = panel.dataset.locale as Locale;
	let profile: AccountProfile | null = null;
	let version = 0;
	let request: AbortController | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let expiresAt = 0;
	const reset = () => {
		version++; request?.abort(); request = null; clearTimeout(timer);
		expiresAt = 0; prompt.value = ''; expiry.textContent = ''; expiry.removeAttribute('datetime');
		result.hidden = true; status.textContent = ''; generate.disabled = false; generate.textContent = ui.generate;
		panel.removeAttribute('aria-busy');
	};
	const expire = () => { reset(); status.textContent = ui.expired; };
	const session = (event: Event) => {
		const next = (event as CustomEvent<AccountProfile | null>).detail;
		if (!next || next.id !== profile?.id || next.role !== profile?.role) reset();
		profile = next?.role === backendRole(role) ? {...next} : null;
		panel.hidden = !profile;
	};
	const onGenerate = async () => {
		if (!profile || request) return;
		reset();
		const captured = {...profile};
		const current = version;
		request = new AbortController();
		generate.disabled = true; generate.textContent = ui.pending; panel.setAttribute('aria-busy', 'true');
		try {
			const code = await requestPairingCode({signal:request.signal, expectedPrincipal:{userId:captured.id,role:captured.role}});
			if (current !== version || profile?.id !== captured.id || profile?.role !== captured.role) return;
			expiresAt = Date.parse(code.expiresAt);
			if (expiresAt <= Date.now()) { expire(); return; }
			prompt.value = pairingPrompt(role, locale, code.token);
			expiry.dateTime = code.expiresAt; expiry.textContent = new Date(expiresAt).toLocaleString(locale);
			result.hidden = false;
			// Bound the timer; visibility/focus also rechecks wall-clock expiry after suspension.
			const check = () => { if (Date.now() >= expiresAt) expire(); else timer = setTimeout(check, Math.min(expiresAt - Date.now(), 2_147_483_647)); };
			check(); prompt.focus();
		} catch (error) {
			if (current !== version) return;
			status.textContent = ui.errors[error instanceof PairingApiError ? error.code : 'network']; status.focus();
		} finally {
			if (current === version) { request = null; generate.disabled = false; generate.textContent = ui.generate; panel.removeAttribute('aria-busy'); }
		}
	};
	const onCopy = async () => {
		if (!prompt.value || expiresAt <= Date.now()) { expire(); return; }
		const current = version;
		try { await navigator.clipboard.writeText(prompt.value); if (current === version) status.textContent = ui.copied; }
		catch { if (current === version) { status.textContent = ui.manual; prompt.focus(); prompt.select(); } }
	};
	const onPageHide = () => { reset(); profile = null; panel.hidden = true; };
	const checkExpiry = () => { if (expiresAt && Date.now() >= expiresAt) expire(); };
	generate.addEventListener('click', onGenerate); copy.addEventListener('click', onCopy);
	window.addEventListener('relay:session', session); window.addEventListener('pagehide', onPageHide);
	window.addEventListener('focus', checkExpiry); document.addEventListener('visibilitychange', checkExpiry);
	return {reset, destroy() {
		onPageHide(); generate.removeEventListener('click', onGenerate); copy.removeEventListener('click', onCopy);
		window.removeEventListener('relay:session', session); window.removeEventListener('pagehide', onPageHide);
		window.removeEventListener('focus', checkExpiry); document.removeEventListener('visibilitychange', checkExpiry);
	}};
}
