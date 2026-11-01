import { parsePairingToken } from './connection-prompts.ts';

export type PairingErrorCode = 'timeout' | 'unauthorized' | 'rateLimit' | 'malformed' | 'roleMismatch' | 'network' | 'aborted';
export class PairingApiError extends Error {
	readonly code: PairingErrorCode;
	constructor(code: PairingErrorCode) { super(code); this.code = code; }
}
export interface PairingOptions {
	signal?: AbortSignal;
	expectedPrincipal?: {userId: string; role: 'owner' | 'client'};
	timeoutMs?: number;
}
export interface PairingCode { token: string; expiresAt: string; role: 'owner' | 'client' }

export function createPairingRequester(fetcher: typeof fetch, baseUrl: string) {
	return async function requestPairingCode(options: PairingOptions = {}): Promise<PairingCode> {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		let abort: () => void = () => {};
		const canceled = new Promise<never>((_, reject) => {
			abort = () => { controller.abort(); reject(new PairingApiError('aborted')); };
			options.signal?.addEventListener('abort', abort, {once:true});
			if (options.signal?.aborted) abort();
			timer = setTimeout(() => { controller.abort(); reject(new PairingApiError('timeout')); }, options.timeoutMs ?? 15_000);
		});
		try {
			return await Promise.race([canceled, (async () => {
				if (controller.signal.aborted) throw new PairingApiError('aborted');
				const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/api/auth/link-token`, {method:'POST',credentials:'include',cache:'no-store',signal:controller.signal});
				if (response.status === 401) throw new PairingApiError('unauthorized');
				if (response.status === 429) throw new PairingApiError('rateLimit');
				if (response.status !== 201) throw new PairingApiError('malformed');
				let data: unknown;
				try { data = await response.json(); } catch { throw new PairingApiError('malformed'); }
				if (!data || typeof data !== 'object') throw new PairingApiError('malformed');
				const {token, expiresAt, principal} = data as Record<string, unknown>;
				try { parsePairingToken(token as string); } catch { throw new PairingApiError('malformed'); }
				if (typeof expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt)) || new Date(expiresAt).toISOString() !== expiresAt || Date.parse(expiresAt) <= Date.now()) throw new PairingApiError('malformed');
				if (!principal || typeof principal !== 'object') throw new PairingApiError('malformed');
				const {role, userId} = principal as Record<string,unknown>;
				if ((role !== 'owner' && role !== 'client') || typeof userId !== 'string' || !userId.trim()) throw new PairingApiError('malformed');
				if (options.expectedPrincipal && (role !== options.expectedPrincipal.role || userId !== options.expectedPrincipal.userId)) throw new PairingApiError('roleMismatch');
				if (controller.signal.aborted) throw new PairingApiError('aborted');
				return {token:token as string,expiresAt,role};
			})()]);
		} catch (error) {
			if (error instanceof PairingApiError) throw error;
			throw new PairingApiError('network');
		} finally { clearTimeout(timer!); options.signal?.removeEventListener('abort', abort); }
	};
}
