import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the `DB` D1 binding in vite.config.ts and provide the database in the Worker environment before using it."
    );
  }

  return drizzle(env.DB, { schema });
}
