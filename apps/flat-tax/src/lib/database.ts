import { Pool } from "pg";

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "5432"),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: {
        rejectUnauthorized: false,
      },
    });

    pool.on("error", (err: Error) => {
      // Using console.error for database connection errors is acceptable
      // eslint-disable-next-line no-console
      console.error("PostgreSQL pool error:", err);
    });
  }

  return pool;
};

