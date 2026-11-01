import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { migrateLegacyOnConnection, type MigrationCounts } from '../src/services/legacy-migration.service.js';

export async function migrateLegacyBusinesses(options: {dryRun:boolean}): Promise<MigrationCounts> {
  const uri=process.env.MONGODB_URI;
  if (!uri) throw new Error('Set an explicit MONGODB_URI for this manual migration.');
  const connection=mongoose.createConnection(uri,{autoCreate:false,autoIndex:false});
  try { await connection.asPromise(); return await migrateLegacyOnConnection(connection,options); }
  finally { await connection.close(); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--apply' && arg!=='--dry-run') || (args.includes('--apply') && args.includes('--dry-run'))) {
    console.error('Usage: migrate:relay [--dry-run | --apply]'); process.exitCode=1;
  } else {
    migrateLegacyBusinesses({dryRun:!args.includes('--apply')}).then(result=>console.log(JSON.stringify(result))).catch(()=>{
      console.error('Legacy migration failed; connection details suppressed. Review backup and retry safely.'); process.exitCode=1;
    });
  }
}
