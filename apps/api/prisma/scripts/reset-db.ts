/**
 * Wipes the database, re-applies every migration and seeds it again:
 * running numbers, plans, prices, features, metrics and the super admin.
 * EVERYTHING else is deleted (users, agents, subscriptions, payments,
 * receipts, cash, machines, …).
 *
 *   npm run db:reset                 asks you to type the database host to confirm
 *   npm run db:reset -- --yes        no question (scripts / CI on a dev database)
 *
 * Super admin login: SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (≥ 12 chars)
 * from .env, or the --email / --password flags; asked for when missing.
 * SUPER_ADMIN_AGENT_ID (default SUPERADMIN) is the login id.
 *
 * Refuses NODE_ENV=production and database URLs that look like production.
 */
import "dotenv/config";

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);

  return index >= 0 ? args[index + 1] : undefined;
};
const yes = args.includes("--yes");

function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function run(label: string, command: string, commandArgs: string[], env: NodeJS.ProcessEnv) {
  console.log(`\n▶ ${label}`);

  const result = spawnSync(command, commandArgs, { stdio: "inherit", env, shell: process.platform === "win32" });

  if (result.status !== 0) {
    fail(`${label} failed (exit ${result.status ?? result.signal}).`);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) fail("DATABASE_URL is not set.");
  if (process.env.NODE_ENV === "production") fail("Refusing to reset with NODE_ENV=production.");

  let host = "";

  try {
    host = new URL(url).host;
  } catch {
    fail("DATABASE_URL is not a valid URL.");
  }

  if (/prod/i.test(url) && !args.includes("--i-know-this-is-not-production")) {
    fail(`The database URL looks like production (${host}). Use a dev database.`);
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n⚠️  This deletes ALL data in ${host} and seeds it again.`);

  if (!yes) {
    const typed = (await prompt.question(`Type the database host to continue (${host}): `)).trim();

    if (typed !== host) {
      prompt.close();
      fail("Host didn't match. Nothing was changed.");
    }
  }

  const email = (flag("email") ?? process.env.SUPER_ADMIN_EMAIL ?? (await prompt.question("Super admin email: "))).trim();
  const password = flag("password") ?? process.env.SUPER_ADMIN_PASSWORD ?? (await prompt.question("Super admin password (min 12 chars): "));

  prompt.close();

  if (!email.includes("@")) fail("Give a valid super admin email.");
  if (password.length < 12) fail("The super admin password must be at least 12 characters.");

  const env = {
    ...process.env,
    SUPER_ADMIN_EMAIL: email,
    SUPER_ADMIN_PASSWORD: password,
    SUPER_ADMIN_RESET_PASSWORD: "true",
  };

  // Drops every table, re-applies all migrations and regenerates the client.
  run("Reset database (drop + migrate)", "npx", ["prisma", "migrate", "reset", "--force", "--skip-seed"], env);

  // Plans, prices, features, metrics, running numbers and the super admin.
  run("Seed", "npx", ["prisma", "db", "seed"], env);

  console.log(`\n✅ Done. Super admin: ${process.env.SUPER_ADMIN_AGENT_ID?.trim() || "SUPERADMIN"} / ${email}\n`);
}

main().catch((error) => fail((error as Error).message));
