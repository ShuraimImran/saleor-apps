import { NextRequest, NextResponse } from "next/server";

import { getPool } from "@/lib/database";
import { createLogger } from "@/lib/logger";
import { createJwtToken, extractTokenFromCookies, verifyJwtToken, verifyPassword } from "@/modules/wsm-admin/auth";

const logger = createLogger("WsmAdminAuthAPI");

const COOKIE_OPTIONS = `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${15 * 60}`;

/**
 * POST /api/wsm-admin/auth — Login
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const pool = getPool();

    const result = await pool.query(
      "SELECT id, email, password_hash FROM wsm_admin_users WHERE email = $1 LIMIT 1",
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      logger.warn("Login attempt with unknown email", { email });

      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const user = result.rows[0];
    const isValid = await verifyPassword(password, user.password_hash);

    if (!isValid) {
      logger.warn("Login attempt with wrong password", { email });

      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = createJwtToken({ email: user.email, userId: user.id });

    logger.info("Admin login successful", { email: user.email });

    const response = NextResponse.json({
      success: true,
      email: user.email,
    });

    response.headers.set("Set-Cookie", `wsm_admin_token=${token}; ${COOKIE_OPTIONS}`);

    return response;
  } catch (error) {
    logger.error("Login error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/wsm-admin/auth — Check session
 */
export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie");
  const token = extractTokenFromCookies(cookieHeader);

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const payload = verifyJwtToken(token);

  if (!payload) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    email: payload.email,
  });
}

/**
 * DELETE /api/wsm-admin/auth — Logout
 */
export async function DELETE() {
  const response = NextResponse.json({ success: true });

  response.headers.set(
    "Set-Cookie",
    "wsm_admin_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
  );

  return response;
}
