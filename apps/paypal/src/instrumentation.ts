/**
 * Next.js startup hook — runs once per server process, before any request is
 * handled.
 *
 * Schema provisioning lives here rather than only in the lazy `provisionSchema()`
 * call the payment lock makes on first use, so that a boot with a broken or
 * unreachable database announces itself in the startup logs instead of surfacing
 * later as a payment guard silently failing open mid-checkout.
 */
export async function register(): Promise<void> {
  /*
   * instrumentation.ts is also evaluated for the edge runtime, where `pg`
   * can't run. Only provision from the Node.js server process.
   */
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { provisionSchema } = await import("@/lib/schema");

  try {
    await provisionSchema();
    // eslint-disable-next-line no-console
    console.log("✅ Database schema provisioned (single transaction).");
  } catch (error) {
    /*
     * Deliberately non-fatal: the app still serves config pages, and the
     * payment lock retries provisioning on first use. Logged loudly because the
     * guard that depends on this fails *open* — this line is the only warning
     * that double-payment protection may be inactive.
     */
    // eslint-disable-next-line no-console
    console.error(
      "❌ Database schema provisioning FAILED at startup — the payment-attempt lock may be inactive until this succeeds:",
      error,
    );
  }
}
