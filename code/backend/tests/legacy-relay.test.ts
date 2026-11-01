import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { buildMongoHarness } from './helpers/relay-mongo.js';
import { migrateLegacyOnConnection } from '../src/services/legacy-migration.service.js';
import { BusinessDraftService } from '../src/services/business-draft.service.js';

test('legacy migration is dry-run safe, concurrent insert-only, private and never infers capacity', async t => {
  const h = await buildMongoHarness(); t.after(() => h.close());
  const db = h.connection.db!;
  const ownerId = new Types.ObjectId();
  const legacy = { _id: new Types.ObjectId(), ownerId, name: 'Legacy fake restaurant', trustStatus: 'trusted', mcpProfile: { category: 'restaurant', cuisine: 'French', address: '1 Fake Street', baseCapacity: 50 }, availableSeats: 40 };
  await db.collection('businesses').insertMany([legacy, { ...legacy, _id: new Types.ObjectId(), mcpProfile: {category:'unknown'} }, { ...legacy, _id: new Types.ObjectId(), relayBusinessId:'live', relayRevision:1 }]);
  await db.collection('relay_inventory').insertOne({ _id: new Types.ObjectId(), sentinel: true });
  const before = await db.collection('businesses').find().toArray();
  await db.collection('relay_business_drafts').drop();
  assert.deepEqual(await migrateLegacyOnConnection(h.connection, {dryRun:true}), {scanned:3,drafted:1,skipped:2});
  assert.equal((await db.listCollections({name:'relay_business_drafts'}).toArray()).length,0);
  const runs = await Promise.all([migrateLegacyOnConnection(h.connection,{dryRun:false}),migrateLegacyOnConnection(h.connection,{dryRun:false})]);
  assert.equal(runs.reduce((n,r)=>n+r.drafted,0),1);
  assert.deepEqual(await migrateLegacyOnConnection(h.connection,{dryRun:false}), {scanned:3,drafted:0,skipped:3});
  const drafts = new BusinessDraftService(h.catalog);
  const [draft] = await drafts.list({role:'owner',userId:ownerId.toHexString()},0,10);
  assert.ok(draft); assert.deepEqual(draft.inventoryEdits,[]); assert.deepEqual(draft.offerings,[]);
  assert.match(JSON.stringify(draft.auditTrail), /owner.review.required/i);
  assert.equal((await drafts.get({role:'owner',userId:ownerId.toHexString()},draft.id)).id,draft.id);
  await assert.rejects(drafts.get({role:'owner',userId:new Types.ObjectId().toHexString()},draft.id));
  assert.deepEqual((await h.catalog.searchPublished({offset:0,limit:10,amenities:[]})).items,[]);
  assert.deepEqual(await db.collection('businesses').find().toArray(),before);
  assert.equal(await db.collection('relay_inventory').countDocuments({sentinel:true}),1);
  await db.collection<{_id:string;revision:number}>('relay_business_drafts').updateOne({_id:draft.id},{$set:{revision:7}});
  await migrateLegacyOnConnection(h.connection,{dryRun:false});
  assert.equal((await drafts.get({role:'owner',userId:ownerId.toHexString()},draft.id)).revision,7);
});

test('migration CLI module import never connects, writes or runs the command', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const result=await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',"const m=await import('./scripts/migrate-relay-legacy.ts'); if(typeof m.migrateLegacyBusinesses!=='function') throw Error('missing interface'); console.log('import only');"],{env:{...process.env,MONGODB_URI:''}});
  assert.equal(result.stdout.trim(),'import only'); assert.equal(result.stderr,'');
});

test('explicit CLI defaults to dry run with no collection creation; --apply alone inserts one draft', async t => {
  const {buildSuiteUri}=await import('./helpers/relay-mongo.js');
  const {createConnection}=await import('mongoose');
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const {uri}=buildSuiteUri();
  const connection=await createConnection(uri,{autoCreate:false,autoIndex:false}).asPromise();
  t.after(async()=>{await connection.dropDatabase();await connection.close();});
  const db=connection.db!;
  await db.collection('businesses').insertOne({_id:new Types.ObjectId(),ownerId:new Types.ObjectId(),name:'Disposable legacy',mcpProfile:{category:'shop'}});
  const collections=await db.listCollections().toArray();
  const indexes=await db.collection('businesses').listIndexes().toArray();
  const run=async(args:string[])=>{
    const {stdout,stderr}=await promisify(execFile)(process.execPath,['--import','tsx','scripts/migrate-relay-legacy.ts',...args],{env:{...process.env,MONGODB_URI:uri}});
    assert.equal(stderr,''); return JSON.parse(stdout) as unknown;
  };
  assert.deepEqual(await run([]),{scanned:1,drafted:1,skipped:0});
  assert.deepEqual(await db.listCollections().toArray(),collections);
  assert.deepEqual(await db.collection('businesses').listIndexes().toArray(),indexes);
  assert.deepEqual(await run(['--apply']),{scanned:1,drafted:1,skipped:0});
  assert.deepEqual(await run(['--apply']),{scanned:1,drafted:0,skipped:1});
  assert.equal(await db.collection('relay_business_drafts').countDocuments(),1);
});
