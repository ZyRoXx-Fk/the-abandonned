import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RelayServerDependencies } from './server-factory.js';
import { activePrincipal } from './server-factory.js';
import { toToolResult, toolResultSchema } from './tool-result.js';
import { relayIdSchema } from '../schemas/relay.schema.js';
import { businessQuerySchema } from '../schemas/catalog.schema.js';
import { customerActionSchema, amendmentSchema, approvalSchema } from '../schemas/action.schema.js';
export function registerCustomerTools(server: McpServer, deps: RelayServerDependencies): void {
  function tool<S extends z.ZodType>(name: string, description: string, schema: S, readOnly: boolean,
    work: (args: z.infer<S>, sessionId?: string) => Promise<unknown>) {
    server.registerTool<typeof toolResultSchema, z.ZodType>(name, { description: `Final human validation is required before any commitment. ${description}`, inputSchema: schema,
      outputSchema: toolResultSchema, annotations: { readOnlyHint: readOnly, destructiveHint: name === 'confirm_customer_action', openWorldHint: false } },
    (args, extra) => toToolResult(() => work(schema.parse(args),extra.sessionId)));
  }
  const p = (id?: string) => activePrincipal(deps,id,'client');
  tool('search_businesses', 'Search published businesses only; capability does not guarantee availability.', businessQuerySchema, true, a => deps.discovery.search(a));
  tool('get_business', 'Read published details, final prices and timestamped known availability.', z.strictObject({businessId:relayIdSchema}), true, a => deps.discovery.getBusiness(a.businessId));
  tool('search_restaurants', 'Legacy published restaurant discovery only.', businessQuerySchema.omit({category:true}), true, a => deps.discovery.search({...a,category:'restaurant'}));
  tool('prepare_customer_action', 'Prepare authoritative terms for pickup order or reservation; reserves nothing, expires in 15 minutes. Demo is not paid.', customerActionSchema, false, (a,id) => deps.actionProposals.prepare(p(id),a));
  tool('get_action_proposal', 'Read only your own action or reservation amendment proposal.', z.strictObject({proposalId:relayIdSchema}), true, (a,id) => deps.actionProposals.get(p(id),a.proposalId));
  tool('confirm_customer_action', 'Commit exact proposal revision only after explicit human approval. Host confirmation is the human-consent trust boundary, not independently verified consent. Demo payment is not collected.', approvalSchema, false, (a,id) => deps.actionCommit.commit(p(id),a));
  tool('get_my_action', 'Read your own durable confirmed action.', z.strictObject({id:relayIdSchema}), true, (a,id) => deps.actionCommit.getAction(p(id),a.id));
  tool('prepare_reservation_amendment', 'Prepare a reservation-only change; failed changes leave original allocation untouched. Review and approve again.', amendmentSchema, false, (a,id) => deps.amendments.prepare(p(id),a));
}
