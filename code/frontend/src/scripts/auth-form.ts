import { authenticate, currentSession, logout, AuthApiError, type AccountProfile } from '../lib/auth-api';
import type { Messages } from '../i18n/messages';
import type { AuthAction, Role } from '../lib/profiles';

type FormMessages = Pick<Messages['auth'], 'validation' | 'errors' | 'pendingLogin' | 'pendingRegister' | 'pendingLogout' | 'connectedTitle' | 'registerSuccess' | 'loginSuccess' | 'sessionActive'>;

function initializeAuthForm() {
	const section = document.querySelector<HTMLElement>('.auth-form-section');
	const form = section?.querySelector<HTMLFormElement>('.auth-form');
	const submit = form?.querySelector<HTMLButtonElement>('[type="submit"]');
	const message = section?.querySelector<HTMLElement>('.auth-message');
	const formRegion = section?.querySelector<HTMLElement>('[data-form-region]');
	const accountPanel = section?.querySelector<HTMLElement>('[data-account-panel]');
	const heading = section?.querySelector<HTMLElement>('#auth-title');
	const logoutButton = section?.querySelector<HTMLButtonElement>('[data-logout]');
	if (!section?.dataset.authMessages || !form || !submit || !message || !formRegion || !accountPanel || !heading || !logoutButton) return;
	if (!['client', 'business'].includes(form.dataset.role || '') || !['login', 'register'].includes(form.dataset.action || '')) return;

	const ui: FormMessages = JSON.parse(section.dataset.authMessages);
	const role = form.dataset.role as Role;
	const action = form.dataset.action as AuthAction;
	const originalTitle = heading.textContent || '';
	const submitLabel = submit.textContent || '';
	const logoutLabel = logoutButton.textContent || '';
	const inputs = form.querySelectorAll<HTMLInputElement>('input');
	const password = form.querySelector<HTMLInputElement>('#password');
	const confirmation = form.querySelector<HTMLInputElement>('#confirm-password');
	let busy = false;
	let activity = 0;
	submit.disabled = false;

	function validateInput(input: HTMLInputElement) {
		input.setCustomValidity('');
		if (input.validity.valueMissing) input.setCustomValidity(ui.validation.required);
		else if (input.validity.typeMismatch) input.setCustomValidity(ui.validation.email);
		else if (input.minLength > 0 && input.value.length < input.minLength) input.setCustomValidity(ui.validation.passwordLength);
		else if (['firstName', 'lastName'].includes(input.name) && !input.value.trim()) input.setCustomValidity(ui.validation.nameRequired);
		else if (input === password && action === 'register' && new TextEncoder().encode(input.value).length > 72) input.setCustomValidity(ui.validation.passwordTooLong);
		else if (input === confirmation && input.value !== password?.value) input.setCustomValidity(ui.validation.passwordMismatch);
	}
	inputs.forEach((input) => {
		input.addEventListener('input', () => validateInput(input));
		input.addEventListener('invalid', () => validateInput(input));
	});
	password?.addEventListener('input', () => { if (confirmation?.value) validateInput(confirmation); });

	form.querySelectorAll<HTMLButtonElement>('.toggle-password').forEach((button) => {
		button.addEventListener('click', () => {
			const input = document.getElementById(button.getAttribute('aria-controls') || '') as HTMLInputElement | null;
			if (!input) return;
			const show = input.type === 'password';
			input.type = show ? 'text' : 'password';
			button.setAttribute('aria-pressed', String(show));
			button.setAttribute('aria-label', (show ? button.dataset.hideLabel : button.dataset.showLabel) || '');
		});
	});

	const showError = (error: unknown) => {
		const code = error instanceof AuthApiError ? error.code : 'server';
		message.textContent = ui.errors[code];
		message.hidden = false;
		message.focus();
	};
	const resetForm = () => {
		form.reset();
		inputs.forEach((input) => input.setCustomValidity(''));
		if (password) password.type = 'password';
		if (confirmation) confirmation.type = 'password';
		form.querySelectorAll<HTMLButtonElement>('.toggle-password').forEach((button) => {
			button.setAttribute('aria-pressed', 'false');
			button.setAttribute('aria-label', button.dataset.showLabel || '');
		});
	};
	const showForm = () => {
		accountPanel.hidden = true;
		formRegion.hidden = false;
		heading.textContent = originalTitle;
		message.hidden = true;
		accountPanel.querySelectorAll<HTMLElement>('[data-account-name], [data-account-email], [data-account-status]').forEach((element) => { element.textContent = ''; });
		resetForm();
	};

	const showSession = (profile: AccountProfile, status: string, focus = false) => {
		const name = accountPanel.querySelector<HTMLElement>('[data-account-name]');
		const email = accountPanel.querySelector<HTMLElement>('[data-account-email]');
		const accountStatus = accountPanel.querySelector<HTMLElement>('[data-account-status]');
		if (name) name.textContent = `${profile.firstName} ${profile.lastName}`;
		if (email) email.textContent = profile.email;
		if (accountStatus) accountStatus.textContent = status;
		heading.textContent = ui.connectedTitle;
		formRegion.hidden = true;
		accountPanel.hidden = false;
		message.hidden = true;
		resetForm();
		if (focus) accountPanel.focus();
	};

	const restoreSession = async () => {
		const startedAt = activity;
		try {
			const profile = await currentSession();
			if (activity === startedAt) {
				if (profile?.role === (role === 'business' ? 'owner' : 'client')) showSession(profile, ui.sessionActive);
				else if (!accountPanel.hidden) showForm();
			}
		} catch {
			// A backend outage must not prevent entering or submitting the form.
		}
	};
	void restoreSession();
	window.addEventListener('pageshow', (event) => { if (event.persisted) void restoreSession(); });
	form.addEventListener('input', () => { message.hidden = true; });

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		if (busy) return;
		inputs.forEach((input) => {
			if (['firstName', 'lastName', 'email'].includes(input.name)) input.value = input.value.trim();
			validateInput(input);
		});
		if (!form.reportValidity()) return;
		const values = new FormData(form);
		const credentials = {
			email: String(values.get('email') || '').toLowerCase(),
			password: String(values.get('password') || ''),
			...(action === 'register' ? {
				firstName: String(values.get('firstName') || ''),
				lastName: String(values.get('lastName') || ''),
			} : {}),
		};
		busy = true;
		activity++;
		message.hidden = true;
		submit.disabled = true;
		submit.textContent = action === 'register' ? ui.pendingRegister : ui.pendingLogin;
		form.setAttribute('aria-busy', 'true');
		inputs.forEach((input) => { input.disabled = true; });
		try {
			const profile = await authenticate(role, action, credentials);
			showSession(profile, action === 'register' ? ui.registerSuccess : ui.loginSuccess, true);
		} catch (error) {
			showError(error);
		} finally {
			busy = false;
			submit.disabled = false;
			submit.textContent = submitLabel;
			inputs.forEach((input) => { input.disabled = false; });
			form.removeAttribute('aria-busy');
		}
	});

	logoutButton.addEventListener('click', async () => {
		if (busy) return;
		busy = true;
		activity++;
		logoutButton.disabled = true;
		logoutButton.textContent = ui.pendingLogout;
		try {
			await logout();
			showForm();
			form.querySelector<HTMLInputElement>('input')?.focus();
		} catch (error) {
			showError(error);
		} finally {
			busy = false;
			logoutButton.disabled = false;
			logoutButton.textContent = logoutLabel;
		}
	});
}

initializeAuthForm();
