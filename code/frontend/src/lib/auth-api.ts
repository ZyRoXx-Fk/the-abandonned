import type { Role, AuthAction } from './profiles';

export type AuthErrorCode = 'invalidCredentials' | 'emailExists' | 'validation' | 'rateLimit' | 'network' | 'server' | 'roleMismatch';

export class AuthApiError extends Error {
	constructor(public readonly code: AuthErrorCode) {
		super(code);
	}
}

export interface AccountProfile {
	id: string;
	firstName: string;
	lastName: string;
	email: string;
	role: 'owner' | 'client';
}

export interface AuthCredentials {
	email: string;
	password: string;
	firstName?: string;
	lastName?: string;
}

const baseUrl = (import.meta.env.PUBLIC_API_BASE_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
const tenants = { client: 'clients', business: 'owners' } as const;

async function request(path: string, method = 'GET', body?: AuthCredentials): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);
	try {
		let response: Response;
		try {
			response = await fetch(`${baseUrl}/api/auth${path}`, {
				method,
				credentials: 'include',
				cache: 'no-store',
				signal: controller.signal,
				headers: body ? { 'Content-Type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined,
			});
		} catch {
			throw new AuthApiError('network');
		}
		if (!response.ok) {
			const code = response.status === 401 ? 'invalidCredentials'
				: response.status === 409 ? 'emailExists'
				: response.status === 400 ? 'validation'
				: response.status === 429 ? 'rateLimit' : 'server';
			throw new AuthApiError(code);
		}
		if (response.status === 204) return null;
		try {
			return await response.json();
		} catch {
			throw new AuthApiError(controller.signal.aborted ? 'network' : 'server');
		}
	} finally {
		clearTimeout(timeout);
	}
}

function parseProfile(data: unknown): AccountProfile {
	if (typeof data !== 'object' || data === null) throw new AuthApiError('server');
	const profile = data as Record<string, unknown>;
	if (!['owner', 'client'].includes(String(profile.role)) ||
		!['id', 'firstName', 'lastName', 'email'].every((key) => typeof profile[key] === 'string')) {
		throw new AuthApiError('server');
	}
	return {
		id: profile.id as string,
		firstName: profile.firstName as string,
		lastName: profile.lastName as string,
		email: profile.email as string,
		role: profile.role as AccountProfile['role'],
	};
}

export async function authenticate(role: Role, action: AuthAction, credentials: AuthCredentials): Promise<AccountProfile> {
	const data = await request(`/${tenants[role]}/${action}`, 'POST', credentials);
	if (typeof data !== 'object' || data === null || !('user' in data) || !('role' in data)) throw new AuthApiError('server');
	const profile = parseProfile({ ...data.user as object, role: data.role });
	if (profile.role !== (role === 'business' ? 'owner' : 'client')) {
		await logout();
		throw new AuthApiError('roleMismatch');
	}
	// The backend sets an HttpOnly cookie. The JSON bearer token is deliberately not stored.
	return profile;
}

export async function currentSession(): Promise<AccountProfile | null> {
	try {
		return parseProfile(await request('/me'));
	} catch (error) {
		if (error instanceof AuthApiError && error.code === 'invalidCredentials') return null;
		throw error;
	}
}

export async function logout(): Promise<void> {
	await request('/logout', 'POST');
}
