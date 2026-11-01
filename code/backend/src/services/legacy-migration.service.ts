import { Types, type Connection } from 'mongoose';
import { businessDraftSchema } from '../schemas/catalog.schema.js';
import { businessCategorySchema } from '../schemas/relay.schema.js';

export type MigrationCounts = { scanned: number; drafted: number; skipped: number };

/** Raw collections avoid model initialization (including autoCreate/autoIndex) during dry runs. */
export async function migrateLegacyOnConnection(connection: Connection, options: {dryRun:boolean}): Promise<MigrationCounts> {
  const db = connection.db;
  if (!db) throw new Error('An explicit connected database is required.');
  const counts = {scanned:0,drafted:0,skipped:0};
  for await (const legacy of db.collection('businesses').find({})) {
    counts.scanned++;
    const category = businessCategorySchema.safeParse(legacy.mcpProfile?.category);
    if (legacy.relayBusinessId || legacy.relayPublishedAt || !category.success || !(legacy._id instanceof Types.ObjectId) || !(legacy.ownerId instanceof Types.ObjectId)) { counts.skipped++; continue; }
    const id = `legacy_${legacy._id.toHexString()}`;
    // Deterministic _id uses MongoDB's built-in unique index, not an asynchronously created index.
    if (await db.collection<{_id:string;[key:string]:unknown}>('relay_business_drafts').findOne({_id:id})) { counts.skipped++; continue; }
    const now = new Date().toISOString();
    const suggestedValues: Array<{path:string;value:string}> = [];
    for (const [path,value] of [['profile.name',legacy.name],['profile.address',legacy.mcpProfile?.address],['profile.categoryConfig.cuisine',category.data==='restaurant'?legacy.mcpProfile?.cuisine:undefined]]) {
      if (typeof value === 'string' && value.trim() && value.length<=500) suggestedValues.push({path,value});
    }
    const draft = businessDraftSchema.parse({id,businessId:id,ownerId:legacy.ownerId.toHexString(),category:category.data,revision:0,baseBusinessRevision:0,
      profile:{categoryConfig:{kind:category.data}},offerings:[],inventoryEdits:[],
      auditTrail:[{observedAt:now,notes:[`Legacy business ${legacy._id.toHexString()}: owner review required; unconfirmed suggestions only. Legacy trust is not identity certification. Capacity and availability were not imported.`],suggestedValues,missingFields:[]}],createdAt:now,updatedAt:now});
    if (options.dryRun) { counts.drafted++; continue; }
    const {id:draftId,...fields}=draft;
    try {
      const result=await db.collection<{_id:string;[key:string]:unknown}>('relay_business_drafts').updateOne({_id:draftId},{$setOnInsert:fields},{upsert:true});
      if(result.upsertedCount===1) counts.drafted++; else counts.skipped++;
    } catch(error) {
      if (error && typeof error==='object' && 'code' in error && error.code===11000 && await db.collection<{_id:string;[key:string]:unknown}>('relay_business_drafts').findOne({_id:draftId})) counts.skipped++;
      else throw error;
    }
  }
  return counts;
}
