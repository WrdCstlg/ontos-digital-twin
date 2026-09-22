/**
 * One-shot database bootstrap — the `init` service in docker-compose.yml.
 *
 *   1. Apply pending SQL migrations from db/migrations. Idempotent: drizzle
 *      records each applied migration in `__drizzle_migrations`.
 *   2. Seed the demo workspace, but only when it is missing or incomplete.
 *      Both seed scripts wipe every Ontos table — the hash-linked audit chain
 *      included — before inserting, so they must never run against a database
 *      that already holds real data.
 *   3. Provision the admin account from ADMIN_EMAIL / ADMIN_PASSWORD. The seed
 *      never creates users and production refuses demo login, so without this
 *      a fresh deployment has no account anyone can sign in with.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { ontologyModules, users, workspaces, workspaceMembers } from "./schema";
import { getDb } from "../api/queries/connection";
import { hashPassword } from "../api/lib/password";
import { env } from "../api/lib/env";

const MIN_ADMIN_PASSWORD_LENGTH = 12;

/** Directory holding this bundle — dist/db once built. */
const here = path.dirname(fileURLToPath(import.meta.url));

const log = (msg: string) => console.log(`[bootstrap] ${msg}`);

type SeedState = "empty" | "partial" | "complete";

/**
 * The twin module is registered by seed-twins, the last seed step, so its
 * presence means a seed run finished. A workspace without it means a previous
 * run died part-way; reseeding is safe then because only demo data exists.
 */
async function seedState(): Promise<SeedState> {
  const db = getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(workspaces);
  if (Number(n) === 0) return "empty";
  const twin = await db
    .select({ id: ontologyModules.id })
    .from(ontologyModules)
    .where(eq(ontologyModules.key, "twin"))
    .limit(1);
  return twin.length > 0 ? "complete" : "partial";
}

/** The seed scripts end with process.exit(), so each runs as its own process. */
function runSeed(file: string) {
  log(`running ${file}`);
  const result = spawnSync(process.execPath, [path.join(here, file)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${file} exited with status ${result.status ?? result.signal}`);
  }
}

/**
 * ADMIN_PASSWORD is authoritative on every boot, so rotating it in the
 * environment takes effect on the next restart. An existing account keeps its
 * display name; only the hash and role are reset.
 */
async function provisionAdmin() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    log("ADMIN_PASSWORD not set — skipping admin provisioning");
    return;
  }
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
  }

  const db = getDb();
  const email = env.adminEmail.trim().toLowerCase();
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

  if (existing) {
    await db.update(users).set({ passwordHash, role: "admin" }).where(eq(users.id, existing.id));
    log(`admin account ${email} updated`);
  } else {
    await db.insert(users).values({ email, name: "Administrator", role: "admin", passwordHash });
    log(`admin account ${email} created`);
  }

  const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (adminUser) {
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    if (ws) {
      const [existingMember] = await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, adminUser.id)))
        .limit(1);
      if (!existingMember) {
        await db.insert(workspaceMembers).values({
          workspaceId: ws.id,
          userId: adminUser.id,
          role: "admin",
        });
        log(`admin enrolled in workspace id=${ws.id}`);
      }
    }
  }
}

async function main() {
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "db/migrations");
  log(`applying migrations from ${migrationsFolder}`);
  await migrate(getDb(), { migrationsFolder });

  const state = await seedState();
  if (state === "complete") {
    log("demo workspace present — seed skipped");
  } else {
    log(state === "empty" ? "empty database — seeding demo workspace" : "incomplete seed detected — reseeding");
    runSeed("seed.js");
    runSeed("seed-twins.js");
  }

  await provisionAdmin();
  log("done");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[bootstrap] failed:", err);
    process.exit(1);
  });
