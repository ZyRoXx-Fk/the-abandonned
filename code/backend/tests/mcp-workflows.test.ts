import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { buildMcpTestApp } from './helpers/mcp-app.js';
import { profile, offering } from './helpers/publication-fixtures.js';

async function call(client: Client, name: string, args: Record<string, unknown> = {}, error = false): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(!!result.isError, error, JSON.stringify(result));
  const text = (result.content as Array<{type:string;text:string}>).find(c => c.type === 'text')!.text;
  if (!result.structuredContent) {
    assert.equal(error, true);
    assert.match(text, /MCP error -32602: Input validation error/);
    assert.doesNotMatch(text, /mongodb|password|stack/i);
    return { code: 'SDK_INPUT_VALIDATION' };
  }
  assert.deepEqual(JSON.parse(text), result.structuredContent);
  const envelope = toolResultSchema.parse(result.structuredContent);
  assert.equal(envelope.ok, !error);
  return error ? envelope.error : envelope.data;
}
const approve = (p: any) => ({ proposalId: p.id, revision: p.revision, approved: true });

test('real HTTP SDK discovers workflow, isolates principals and publishes/actions all categories with amendment readback', async t => {
  const app = await buildMcpTestApp(() => new Date('2027-01-01T00:00:00Z')); t.after(() => app.close());
  const owner = (await app.connect()).client, client = (await app.connect()).client, other = (await app.connect()).client;
  for (const [c, role, userId] of [[owner, 'owner', 'owner_a'], [client, 'client', 'client_a'], [other, 'owner', 'owner_b']] as const) {
    const token = await app.pairing.generateForPrincipal({ role, userId }); await call(c, 'link_session', { token: token.token });
  }
  const names = (await owner.listTools()).tools.map(x => x.name);
  for (const name of ['link_session','pair_session','link_owner_session','audit_website','create_business_draft','get_business_draft','list_business_drafts','update_business_draft','put_business_offering','put_business_inventory','preview_business_publication','publish_business','list_my_businesses','list_business_actions','search_businesses','get_business','prepare_customer_action','get_action_proposal','confirm_customer_action','get_my_action','prepare_reservation_amendment','search_restaurants','save_business_profile','update_business_status']) assert.ok(names.includes(name), name);
  assert.deepEqual((await owner.listPrompts()).prompts.map(p => p.name).sort(), ['customer_assistance','owner_onboarding']);
  for (const name of ['owner_onboarding','customer_assistance']) assert.match(JSON.stringify(await owner.getPrompt({ name })), /final.*human validation/i);
  assert.ok((await owner.listResources()).resources.some(r => r.uri === 'relay://workflow'));
  assert.match(JSON.stringify(await owner.readResource({ uri: 'relay://workflow' })), /not.*paid/i);
  await call(client, 'create_business_draft', { category:'shop' }, true);
  for (const category of ['restaurant','hotel','shop'] as const) {
    let d = await call(owner,'create_business_draft',{category});
    assert.equal((await call(client,'search_businesses')).items.length, category === 'restaurant' ? 0 : category === 'hotel' ? 1 : 2);
    await call(other,'get_business_draft',{draftId:d.id},true);
    await call(client,'prepare_customer_action',{kind:'order',businessId:d.businessId,items:[{offeringId:'item',variantId:'variant',quantity:1}],pickupAt:'2027-01-04T10:00:00Z'},true);
    d = await call(owner,'update_business_draft',{draftId:d.id,expectedRevision:d.revision,patch:{profile:profile(category)}});
    d = await call(owner,'put_business_offering',{draftId:d.id,expectedRevision:d.revision,input:offering(category)});
    const input = category === 'restaurant' ? {kind:'restaurant_slot',id:'slot',slotDate:'2027-01-02',startTime:'18:00',endTime:'20:00',totalSeats:10,minPartySize:1,maxPartySize:6,metadata:[]}
      : category === 'hotel' ? {kind:'room_night',id:'night',roomTypeId:'room',localNight:'2027-01-02',totalRooms:2,metadata:[]}
      : {kind:'sellable_variant',id:'stock',offeringId:'item',variantId:'variant',remainingUnits:10,metadata:[]};
    d = await call(owner,'put_business_inventory',{draftId:d.id,expectedRevision:d.revision,input});
    const p = (await call(owner,'preview_business_publication',{draftId:d.id})).proposal;
    assert.ok(p); await call(owner,'publish_business',{proposalId:p.id,revision:p.revision},true);
    await call(client,'get_business',{businessId:d.businessId},true);
    await call(client,'get_action_proposal',{proposalId:p.id},true);
    await call(owner,'publish_business',approve(p));
    assert.equal((await call(client,'get_business',{businessId:d.businessId})).businessId,d.businessId);
    const action = category === 'restaurant' ? {kind:'restaurant_booking',businessId:d.businessId,slotId:'slot',partySize:2}
      : category === 'hotel' ? {kind:'hotel_booking',businessId:d.businessId,roomTypeId:'room',checkIn:'2027-01-02',checkOut:'2027-01-03',guests:2}
      : {kind:'order',businessId:d.businessId,items:[{offeringId:'item',variantId:'variant',quantity:1}],pickupAt:'2027-01-04T10:00:00Z'};
    const ap = await call(client,'prepare_customer_action',action);
    await call(owner,'confirm_customer_action',approve(ap),true);
    await call(client,'confirm_customer_action',{proposalId:ap.id,revision:ap.revision,approved:false},true);
    assert.deepEqual(await call(owner,'list_business_actions',{businessId:d.businessId}),[]);
    let result = await call(client,'confirm_customer_action',approve(ap));
    if (category !== 'shop') {
      const amendment = category === 'restaurant' ? {kind:'restaurant_booking',reservationId:result.id,expectedReservationRevision:result.revision,slotId:'slot',partySize:3}
        : {kind:'hotel_booking',reservationId:result.id,expectedReservationRevision:result.revision,checkIn:'2027-01-02',checkOut:'2027-01-03',guests:1};
      const a = await call(client,'prepare_reservation_amendment',amendment);
      assert.deepEqual(await call(client,'get_action_proposal',{proposalId:a.id}),a);
      const foreign = (await app.connect()).client;
      await call(foreign,'link_session',{token:(await app.pairing.generateForPrincipal({role:'client',userId:'foreign'})).token});
      await call(foreign,'get_action_proposal',{proposalId:a.id},true);
      result = await call(client,'confirm_customer_action',approve(a));
    }
    assert.deepEqual(await call(client,'get_my_action',{id:result.id}),result);
    assert.deepEqual(await call(owner,'list_business_actions',{businessId:d.businessId}),[result]);
    await call(other,'list_business_actions',{businessId:d.businessId},true);
    await call(client,'list_business_actions',{businessId:d.businessId},true);
    await call(other,'list_business_actions',{businessId:d.businessId,principal:{role:'owner',userId:'owner_a'}},true);
  }
  assert.deepEqual(await call(other,'list_my_businesses'),[]);
  await call(other,'list_my_businesses',{sessionId:'foreign',userId:'owner_a'},true);
  assert.equal((await call(client,'search_restaurants')).items.length,1);
  const before = await call(owner,'list_my_businesses');
  for (const name of ['save_business_profile','update_business_status']) assert.equal((await call(owner,name)).nextAction,'draft_preview_publish');
  assert.deepEqual(await call(owner,'list_my_businesses'),before);
});

test('owner-only legacy pairing releases mismatched token and expired/disconnected drafts resume on fresh pairing', async t => {
  let now = new Date('2027-01-01T00:00:00Z');
  const app = await buildMcpTestApp(() => now); t.after(() => app.close());
  const c = (await app.connect()).client;
  const token = (await app.pairing.generateForPrincipal({role:'client',userId:'client'})).token;
  await call(c,'link_owner_session',{token},true); await call(c,'link_session',{token});
  const first = await app.connect();
  await call(first.client,'link_owner_session',{token:(await app.pairing.generateForPrincipal({role:'owner',userId:'owner'})).token});
  const d = await call(first.client,'create_business_draft',{category:'shop'});
  now = new Date(now.getTime()+31*60000); await app.service.cleanup();
  await assert.rejects(first.client.callTool({name:'get_business_draft',arguments:{draftId:d.id}}));
  const next = await app.connect();
  await call(next.client,'pair_session',{token:(await app.pairing.generateForPrincipal({role:'owner',userId:'owner'})).token});
  assert.equal((await call(next.client,'get_business_draft',{draftId:d.id})).id,d.id);
  await next.transport.terminateSession();
  const fresh = (await app.connect()).client;
  await call(fresh,'link_session',{token:(await app.pairing.generateForPrincipal({role:'owner',userId:'owner'})).token});
  assert.equal((await call(fresh,'list_business_drafts'))[0].id,d.id);
});

import { toToolResult, toolResultSchema } from '../src/mcp/tool-result.js';
import { RelayError } from '../src/utils/relay-error.js';
import { ZodError } from 'zod';
import { auditResultSchema } from '../src/schemas/audit.schema.js';

test('tool-result schema explicitly accepts success, validation/domain errors and redacts unknown exceptions', async () => {
  for (const work of [async () => ({value:1}), async () => {throw new RelayError('FORBIDDEN','Role not permitted.');}, async () => {throw new ZodError([]);}, async () => {throw new Error('mongodb://user:secret@db/internal stack');}]) {
    const result = await toToolResult(work);
    const envelope = toolResultSchema.parse(result.structuredContent);
    assert.deepEqual(JSON.parse((result.content[0] as {text:string}).text),envelope);
    assert.doesNotMatch(JSON.stringify(result), /mongodb|secret|stack/);
  }
  assert.equal(toolResultSchema.safeParse({ok:true,error:{code:'FORBIDDEN',message:'x'}}).success,false);
});

test('real MCP audit preserves advisory untrusted provenance and legacy writes never mutate', async t => {
  const app = await buildMcpTestApp(() => new Date('2027-01-01T00:00:00Z')); t.after(() => app.close());
  const c = (await app.connect()).client;
  await call(c,'link_session',{token:(await app.pairing.generateForPrincipal({role:'owner',userId:'audit_owner'})).token});
  // A literal private IP is rejected by the real safe fetcher, with no network request.
  const result = auditResultSchema.parse(await call(c,'audit_website',{url:'http://127.0.0.1',category:'shop',businessName:'Owner supplied'}));
  assert.equal(result.advisory,true); assert.equal(result.certifying,false); assert.equal(result.fetchStatus,'unsafe_url');
  assert.ok(result.evidence.every(e => e.source === 'owner_input' || e.untrusted));
  assert.ok(result.suggestions.every(s => s.requiresOwnerValidation));
  assert.deepEqual(await call(c,'list_business_drafts'),[]);
  for (const name of ['save_business_profile','update_business_status']) {
    await call(c,name,(name === 'save_business_profile' ? {name:'Legacy',address:'1 Main Street',cuisine:'French',baseCapacity:10} : {businessName:'Legacy',availableSeats:100}));
    await call(c,name,{sessionId:'foreign'},true);
  }
  assert.deepEqual(await call(c,'list_my_businesses'),[]);
});

test('owner-only pairing mismatch replacement/disconnect releases safely without resurrecting old codes', async t => {
  const app = await buildMcpTestApp(); t.after(() => app.close());
  const a = await app.connect();
  const principal = {role:'client' as const,userId:'replace_client'};
  const old = await app.pairing.generateForPrincipal(principal);
  const consume = app.tokens.consume.bind(app.tokens);
  let replacement = '';
  app.tokens.consume = async (...args) => {
    const p = await consume(...args);
    replacement = (await app.pairing.generateForPrincipal(principal)).token;
    return p;
  };
  await call(a.client,'link_owner_session',{token:old.token},true);
  app.tokens.consume = consume;
  await call(a.client,'link_session',{token:old.token},true);
  await call(a.client,'link_session',{token:replacement});
  const b = await app.connect();
  const ownerCode = await app.pairing.generateForPrincipal({role:'owner',userId:'disconnected_owner'});
  app.tokens.consume = async (...args) => { const p = await consume(...args); app.sessions.removeSession(b.transport.sessionId!); return p; };
  await call(b.client,'link_owner_session',{token:ownerCode.token},true);
  app.tokens.consume = consume;
  const fresh = (await app.connect()).client;
  await call(fresh,'link_owner_session',{token:ownerCode.token});
});


test('HTTP handler unknown storage exceptions use safe envelopes rather than internal messages', async t => {
  const app = await buildMcpTestApp(); t.after(() => app.close());
  const c = (await app.connect()).client;
  await call(c,'link_session',{token:(await app.pairing.generateForPrincipal({role:'owner',userId:'owner'})).token});
  const d = await call(c,'create_business_draft',{category:'shop'});
  app.storage.catalog.getDraft = async () => { throw new Error('mongodb://user:secret@db/internal stack'); };
  const error = await call(c,'get_business_draft',{draftId:d.id},true);
  assert.equal(error.code,'UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(error),/mongodb|secret|stack/);
});
