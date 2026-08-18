import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);

// Set session timezone to Mexico City for proper timezone handling
// This ensures timestamps are interpreted as Mexico time, not UTC
try {
  sql('SET TimeZone = "America/Mexico_City"');
} catch {
  // Ignore errors if the SET fails (e.g., in some serverless contexts)
}

const drizzleDb = drizzle(sql, { schema });

export { drizzleDb, schema };
export * from './schema';
