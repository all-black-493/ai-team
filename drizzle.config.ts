import { loadEnvConfig } from "@next/env"
import { defineConfig } from "drizzle-kit"

// Load .env* files the same way Next.js does.
loadEnvConfig(process.cwd())

// Schema changes need a direct connection; the pooled one goes through PgBouncer.
const url = process.env.DATABASE_URL_UNPOOLED
if (!url) {
  throw new Error("DATABASE_URL_UNPOOLED is not set")
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
