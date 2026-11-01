import type { Principal } from './relay.schema.js';
export interface LinkTokenResponseDTO { token: string; expiresAt: Date; principal: Principal }
