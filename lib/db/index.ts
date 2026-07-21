import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
const drizzleDb = drizzle(sql, { schema });

export { drizzleDb, schema };
export * from './schema';
