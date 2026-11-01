import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildSuiteUri } from '../helpers/relay-mongo.js';
import { profile, offering } from '../helpers/publication-fixtures.js';
import { businessDraftSchema, draftPreviewSchema } from '../../src/schemas/catalog.schema.js';
import { actionResultSchema, proposalViewSchema } from '../../src/schemas/action.schema.js';
import { toolResultSchema } from '../../src/mcp/tool-result.js';

// This suite owns the GLOBAL connection used by buildApp. Never use the configured application URI.
test('production buildApp + HTTP SDK + Mongo: authenticated owner onboarding and all three customer journeys', async t => {
  assert.equal(process.env.NODE_ENV,'test','Run this production-composition fixture only with NODE_ENV=test; never allow application startup.');
  const {uri,databaseName} = buildSuiteUri();
  assert.match(databaseName,/^relay_test_/); assert.ok(Buffer.byteLength(databaseName)<=38);
  assert.equal(mongoose.connection.readyState,0);
  const priorSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET=randomBytes(32).toString('hex');
  let app: FastifyInstance | undefined;
  const sessions: Array<{client:Client;transport:StreamableHTTPClientTransport}>=[];
  t.after(async () => {
    try {
      for(const {client,transport} of sessions) { await transport.terminateSession(); await client.close(); }
      await app?.close();
      await Promise.all(Object.values(mongoose.models).map(model=>model.init()));
      await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
      if(priorSecret===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=priorSecret;
    }
    console.log('demo generated DB dropped; global connection closed; HTTP and SDK closed');
  });
  await mongoose.connect(uri);
  const { buildApp } = await import('../../src/index.js');
  app = await buildApp();
  const base = await app.listen({host:'127.0.0.1',port:0});
  async function account(role:'owners'|'clients') {
    const register = await fetch(`${base}/api/auth/${role}/register`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({firstName:'Demo',lastName:role,email:`${role}@example.invalid`,password:'Disposable-fixture-only-42'})});
    assert.equal(register.status,201,'isolated fixture registration');
    const cookie = register.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const token = await fetch(`${base}/api/auth/link-token`, {method:'POST',headers:{cookie}});
    assert.equal(token.status,201,'protected pairing');
    const pairing: unknown = await token.json();
    assert.ok(pairing && typeof pairing === 'object' && 'token' in pairing && typeof pairing.token === 'string');
    const client = new Client({name:'relay-production-demo',version:'1.0.0'});
    const transport = new StreamableHTTPClientTransport(new URL('/mcp',base));
    await client.connect(transport); sessions.push({client,transport});
    await call(client,'link_session',{token:pairing.token});
    return client;
  }
  async function call(client:Client,name:string,args:Record<string,unknown>={},error=false):Promise<unknown> {
    const result = await client.callTool({name,arguments:args});
    assert.equal(!!result.isError,error,'expected safe MCP status');
    const envelope = toolResultSchema.parse(result.structuredContent);
    assert.equal(envelope.ok,!error);
    const projection = JSON.stringify(envelope);
    assert.doesNotMatch(projection,/mongodb(?:\+srv)?:|Disposable-fixture|TRUST-|passwordHash|clientId|ownerId.*password/i);
    return envelope.ok ? envelope.data : envelope.error;
  }
  const owner = await account('owners'), client = await account('clients');
  assert.equal((await fetch(`${base}/api/auth/link-token`,{method:'POST'})).status,401);
  const approve = (p:ReturnType<typeof proposalViewSchema.parse>) => ({proposalId:p.id,revision:p.revision,approved:true});
  for (const category of ['restaurant','hotel','shop'] as const) {
    let d = businessDraftSchema.parse(await call(owner,'create_business_draft',{category}));
    await call(client,'get_business_draft',{draftId:d.id},true);
    await call(client,'get_business',{businessId:d.businessId},true);
    d = businessDraftSchema.parse(await call(owner,'update_business_draft',{draftId:d.id,expectedRevision:d.revision,patch:{profile:{...profile(category),name:`Fictional Relay ${category}`}}}));
    d = businessDraftSchema.parse(await call(owner,'put_business_offering',{draftId:d.id,expectedRevision:d.revision,input:offering(category)}));
    const inputs = category === 'restaurant' ? [
      {kind:'restaurant_slot',id:'slot',slotDate:'2027-01-04',startTime:'12:00',endTime:'14:00',totalSeats:4,minPartySize:1,maxPartySize:4},
      {kind:'sellable_variant',id:'stock',offeringId:'item',variantId:'variant',remainingUnits:4}]
      : category === 'hotel' ? ['2027-01-04','2027-01-05'].map((localNight,i)=>({kind:'room_night',id:`night${i}`,roomTypeId:'room',localNight,totalRooms:1}))
      : [{kind:'sellable_variant',id:'stock',offeringId:'item',variantId:'variant',remainingUnits:4}];
    for (const input of inputs) d = businessDraftSchema.parse(await call(owner,'put_business_inventory',{draftId:d.id,expectedRevision:d.revision,input}));
    const publication = draftPreviewSchema.parse(await call(owner,'preview_business_publication',{draftId:d.id})).proposal; assert.ok(publication);
    await call(owner,'publish_business',approve(publication));
    await call(client,'get_business',{businessId:d.businessId});
    await call(client,'prepare_customer_action',{kind:'order',businessId:d.businessId,items:[{offeringId:'invented',variantId:'bad',quantity:1}],pickupAt:'2027-01-04T10:00:00Z'},true);
    if(category==='restaurant') {
      const p=proposalViewSchema.parse(await call(client,'prepare_customer_action',{kind:'order',businessId:d.businessId,items:[{offeringId:'item',variantId:'variant',quantity:1}],pickupAt:'2027-01-04T10:00:00Z'}));
      const pickup=actionResultSchema.parse(await call(client,'confirm_customer_action',approve(p))); assert.equal(pickup.paymentStatus,'not_collected_demo');
    }
    const action = category === 'restaurant' ? {kind:'restaurant_booking',businessId:d.businessId,slotId:'slot',partySize:2}
      : category === 'hotel' ? {kind:'hotel_booking',businessId:d.businessId,roomTypeId:'room',checkIn:'2027-01-04',checkOut:'2027-01-05',guests:2}
      : {kind:'order',businessId:d.businessId,items:[{offeringId:'item',variantId:'variant',quantity:1}],pickupAt:'2027-01-04T10:00:00Z'};
    const p=proposalViewSchema.parse(await call(client,'prepare_customer_action',action));
    let result=actionResultSchema.parse(await call(client,'confirm_customer_action',approve(p)));
    assert.equal(result.paymentStatus,category==='restaurant'?'not_applicable':'not_collected_demo');
    if(category!=='shop') {
      const amendment=category==='restaurant' ? {kind:'restaurant_booking',slotId:'slot',partySize:3} : {kind:'hotel_booking',checkIn:'2027-01-05',checkOut:'2027-01-06',guests:2};
      const a=proposalViewSchema.parse(await call(client,'prepare_reservation_amendment',{...amendment,reservationId:result.id,expectedReservationRevision:result.revision}));
      result=actionResultSchema.parse(await call(client,'confirm_customer_action',approve(a)));
      if(category==='restaurant') {
        const blocker=proposalViewSchema.parse(await call(client,'prepare_customer_action',{kind:'restaurant_booking',businessId:d.businessId,slotId:'slot',partySize:1}));
        await call(client,'confirm_customer_action',approve(blocker));
      }
      const bad=category==='restaurant'?{kind:'restaurant_booking',slotId:'slot',partySize:4}:{kind:'hotel_booking',checkIn:'2027-01-05',checkOut:'2027-01-07',guests:2};
      const failure=await call(client,'prepare_reservation_amendment',{...bad,reservationId:result.id,expectedReservationRevision:result.revision},true);
      assert.ok(failure && typeof failure==='object' && 'code' in failure); assert.equal(failure.code,'UNAVAILABLE');
      assert.deepEqual(await call(client,'get_my_action',{id:result.id}),result);
    }
    const records=await call(owner,'list_business_actions',{businessId:d.businessId}); assert.ok(Array.isArray(records)); assert.ok(records.some(r=>r.id===result.id));
    await call(client,'list_business_actions',{businessId:d.businessId},true);
  }
  const businesses=await call(owner,'list_my_businesses'); assert.ok(Array.isArray(businesses)); assert.equal(businesses.length,3);
});
