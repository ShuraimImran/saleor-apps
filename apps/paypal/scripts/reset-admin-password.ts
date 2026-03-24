#!/usr/bin/env tsx

/**
 * Reset WSM Admin Password
 *
 * Usage:
 *   pnpm reset-admin-password --email admin@example.com --password NewPassword123
 *
 * If no admin user exists with that email, it creates one.
 * If the user exists, it updates the password.
 *
 * Environment Variables Required (loaded via --env-file-if-exists=.env):
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */

import * as crypto from "crypto";

import { Pool } from "pg";

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");

    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function parseArgs(): { email: string; password: string } {
  const args = process.argv.slice(2);
  let email = "";
  let password = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email" && args[i + 1]) {
      email = args[i + 1];
      i++;
    } else if (args[i] === "--password" && args[i + 1]) {
      password = args[i + 1];
      i++;
    }
  }

  if (!email || !password) {
    console.error("Usage: pnpm reset-admin-password --email admin@example.com --password NewPassword123");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Password must be at least 8 characters long");
    process.exit(1);
  }

  return { email: email.toLowerCase().trim(), password };
}

async function main() {
  const { email, password } = parseArgs();

  const requiredEnvVars = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];
  const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missingEnvVars.length > 0) {
    console.error("Missing required environment variables:", missingEnvVars.join(", "));
    console.error("Please set these variables in your .env file");
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  try {
    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO wsm_admin_users (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email)
       DO UPDATE SET password_hash = $2, updated_at = NOW()
       RETURNING id, email`,
      [email, passwordHash]
    );

    const user = result.rows[0];

    console.log(`Password updated successfully for ${user.email}`);
  } catch (error) {
    console.error("Failed to update password:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
