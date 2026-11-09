import { attachDatabasePool } from "@vercel/functions"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "./schema"

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error("DATABASE_URL is not set")
}

// Pooled Neon connection for app traffic. attachDatabasePool releases idle
// clients before a Vercel Fluid compute instance suspends.
const pool = new Pool({ connectionString })
attachDatabasePool(pool)

export const db = drizzle({ client: pool, schema })
