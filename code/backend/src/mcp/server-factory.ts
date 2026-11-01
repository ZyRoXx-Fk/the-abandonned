import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pairSessionSchema } from '../schemas/mcp.schema.js';
import type { LinkTokenService } from '../services/link-token.service.js';
import type { McpSessionManager } from '../utils/managers/mcp-session.manager.js';
import type { Principal } from '../schemas/relay.schema.js';
import type { BusinessDraftService } from '../services/business-draft.service.js';
import type { PublicationService } from '../services/publication.service.js';
import type { DiscoveryService } from '../services/discovery.service.js';
import type { ActionProposalService } from '../services/action-proposal.service.js';
import type { ActionCommitService } from '../services/action-commit.service.js';
import type { ReservationAmendmentService } from '../services/reservation-amendment.service.js';
import type { AuditService } from '../services/audit.service.js';
import { RelayError } from '../utils/relay-error.js';
import { toToolResult, toolResultSchema } from './tool-result.js';
import { registerOwnerTools } from './register-owner-tools.js';
import { registerCustomerTools } from './register-customer-tools.js';
import { registerWorkflowPrompts } from './register-workflow-prompts.js';
export interface RelayDomainServices {
  drafts: BusinessDraftService; publication: PublicationService; discovery: DiscoveryService;
  actionProposals: ActionProposalService; actionCommit: ActionCommitService;
  amendments: ReservationAmendmentService; audit: AuditService;
}
export interface RelayServerDependencies extends RelayDomainServices {
  pairing: LinkTokenService;
  sessions: McpSessionManager;
}
export function activePrincipal(deps: RelayServerDependencies, sessionId?: string, role?: Principal['role']): Principal {
  const principal = sessionId && deps.sessions.getSession(sessionId)?.principal;
  if (!principal) throw new RelayError('AUTH_REQUIRED','Pair this live session on the trusted website first.');
  if (role && principal.role !== role) throw new RelayError('FORBIDDEN','Role not permitted.');
  return { ...principal };
}
export function createRelayServer(deps: RelayServerDependencies): McpServer {
  const server = new McpServer({ name: 'the-abandonned', version: '1.0.0' });
  server.registerResource('system-health', 'system://health', {}, async uri => ({ contents: [{ uri: uri.href, text: JSON.stringify({ status: 'operational' }) }] }));
  const pair = (expectedRole?: Principal['role']) => async (args: {token:string}, extra: {sessionId?:string}) => toToolResult(async () => {
    const input = pairSessionSchema.parse(args);
    try {
      if (!extra.sessionId) throw new Error('Live session required');
      const principal = await deps.pairing.consumeForSession(input.token,extra.sessionId,expectedRole);
      deps.sessions.requirePrincipal(extra.sessionId);
      return { paired:true,role:principal.role };
    } catch (error) {
      throw new RelayError('AUTH_REQUIRED',error instanceof Error && error.message === 'Too many pairing failures' ? error.message : 'Pairing failed. Use a fresh code on a live unpaired connection.');
    }
  });
  const canonicalPair = pair();
  for (const name of ['link_session','pair_session','link_owner_session']) server.registerTool(name, {
    description: 'Final human validation is required before future publication or actions. Pair this connection with a one-use code from the trusted website; never passwords or bearer tokens. link_owner_session accepts owners only.',
    inputSchema:pairSessionSchema,outputSchema:toolResultSchema,annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  }, name === 'link_owner_session' ? pair('owner') : canonicalPair);
  registerOwnerTools(server,deps); registerCustomerTools(server,deps); registerWorkflowPrompts(server);
  return server;
}
