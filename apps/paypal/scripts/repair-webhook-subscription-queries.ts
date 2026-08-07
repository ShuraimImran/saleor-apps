#!/usr/bin/env tsx
/**
 * Bring an existing install's webhook subscription queries up to date with this
 * app's code, WITHOUT creating or deleting anything.
 *
 * WHY THIS EXISTS, SEPARATELY FROM `pnpm migrate`:
 *   `pnpm migrate` (scripts/run-webhooks-migration.ts) reconciles webhooks by
 *   name and therefore also *adds* missing ones and *deletes* any webhook whose
 *   name is absent from its manifest list
 *   (packages/webhook-utils/src/filters/webhooks-to-remove.ts). That is correct
 *   for routine migrations but it is not the tool you want when a live merchant
 *   is taking payments and all you need to change is one stored query.
 *
 *   Reinstalling the app is the other commonly suggested fix and it is worse:
 *   PayPal credentials and channel mappings live in Saleor *app private
 *   metadata* (src/modules/paypal/configuration/paypal-config-repo.ts), so a
 *   reinstall hands you a fresh App object with an empty configuration.
 *
 * WHAT IT DOES:
 *   For each webhook this app declares (the same six registered by
 *   src/app/api/manifest/route.ts), find the install's existing webhook of that
 *   name and, if its stored subscriptionQuery differs from what the code now
 *   generates, issue `webhookUpdate(id:, input: { query })`.
 *
 * NON-DESTRUCTIVE, THREE WAYS:
 *   - `query` is the ONLY field ever sent. Every field of WebhookUpdateInput is
 *     optional, so name, targetUrl, sync/async events, isActive and
 *     customHeaders are left exactly as they are. The webhook keeps its id, so
 *     nothing that references it is invalidated.
 *   - webhookCreate and webhookDelete are never called. A declared webhook that
 *     does not exist on the install is REPORTED, not created — that is a
 *     genuine install problem and silently papering over it would hide it. A
 *     webhook on the install that this app does not declare is left alone.
 *   - Writes require `--apply`. Without it the script only reports the diff,
 *     which is the opposite default from `pnpm migrate`, deliberately: this
 *     script is reached for during incidents.
 *
 * PERMISSIONS: `webhookUpdate` accepts MANAGE_APPS or AUTHENTICATED_APP, and
 * the `app` query with no id returns the requesting app — so the app's own APL
 * token is sufficient. No staff credentials needed.
 *
 * Usage (env loaded from .env, same as `pnpm migrate`):
 *   pnpm repair:webhook-queries -- --saleor-api-url=https://api.example.com/graphql/
 *   pnpm repair:webhook-queries -- --saleor-api-url=https://api.example.com/graphql/ --apply
 *   pnpm repair:webhook-queries -- --all              # report every install in the APL
 */
import { parseArgs } from "node:util";

import { parse, print } from "graphql";

import { paymentGatewayInitializeSessionWebhookDefinition } from "@/app/api/webhooks/saleor/payment-gateway-initialize-session/webhook-definition";
import { transactionCancelationRequestedWebhookDefinition } from "@/app/api/webhooks/saleor/transaction-cancelation-requested/webhook-definition";
import { transactionChargeRequestedWebhookDefinition } from "@/app/api/webhooks/saleor/transaction-charge-requested/webhook-definition";
import { transactionInitializeSessionWebhookDefinition } from "@/app/api/webhooks/saleor/transaction-initialize-session/webhook-definition";
import { transactionProcessSessionWebhookDefinition } from "@/app/api/webhooks/saleor/transaction-process-session/webhook-definition";
import { transactionRefundRequestedWebhookDefinition } from "@/app/api/webhooks/saleor/transaction-refund-requested/webhook-definition";
import { createGraphQLClient } from "@/lib/graphql-client";
import { saleorApp } from "@/lib/saleor-app";

import { createMigrationScriptLogger } from "./migration-logger";

const logger = createMigrationScriptLogger("WebhookQueryRepair");

const {
  values: { "saleor-api-url": saleorApiUrlArg, all: allInstalls, apply },
} = parseArgs({

  /*
   * `pnpm run <script> -- --flag` forwards the literal `--` separator through to
   * the script. parseArgs treats `--` as end-of-options and then rejects the
   * real flags after it as positionals (ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL),
   * which is exactly what the documented `pnpm repair:webhook-queries -- --saleor-api-url=…`
   * invocation hits. This script takes no positionals, so drop any `--` before
   * parsing — that keeps both the pnpm form and a direct `tsx …/repair-…ts --saleor-api-url=…`
   * working.
   */
  args: process.argv.slice(2).filter((arg) => arg !== "--"),

  options: {
    "saleor-api-url": { type: "string" },
    all: { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
});

if (!saleorApiUrlArg && !allInstalls) {
  logger.error("Pass --saleor-api-url=<url>, or --all to cover every install in the APL");
  process.exit(1);
}

/*
 * Same set as src/app/api/manifest/route.ts. Only `name` and `query` are read
 * from each manifest; the base url is a placeholder because targetUrl is never
 * part of the update this script performs.
 */
const PLACEHOLDER_BASE_URL = "https://placeholder.invalid";

const declaredWebhooks = [
  paymentGatewayInitializeSessionWebhookDefinition,
  transactionInitializeSessionWebhookDefinition,
  transactionProcessSessionWebhookDefinition,
  transactionChargeRequestedWebhookDefinition,
  transactionCancelationRequestedWebhookDefinition,
  transactionRefundRequestedWebhookDefinition,
].map((definition) => {
  const manifest = definition.getWebhookManifest(PLACEHOLDER_BASE_URL);

  return {
    name: manifest.name,
    query: typeof manifest.query === "string" ? manifest.query : print(manifest.query as never),
  };
});

const AppWebhooksQuery = `
  query AppWebhooksForRepair {
    app {
      id
      name
      webhooks { id name subscriptionQuery }
    }
  }
`;

const WebhookUpdateQueryMutation = `
  mutation RepairWebhookSubscriptionQuery($id: ID!, $query: String!) {
    webhookUpdate(id: $id, input: { query: $query }) {
      errors { field message code }
      webhook { id name }
    }
  }
`;

/*
 * Saleor stores the query as sent, so a difference in formatting alone would
 * otherwise read as a difference in content. Compare ASTs, not strings.
 */
const normalize = (query: string | null | undefined): string => {
  if (!query) return "";

  try {
    return print(parse(query));
  } catch {
    return query.trim();
  }
};

interface RepairSummary {
  saleorApiUrl: string;
  updated: string[];
  alreadyCurrent: string[];
  missing: string[];
  failed: string[];
}

const repairInstall = async (saleorApiUrl: string, token: string): Promise<RepairSummary> => {
  const summary: RepairSummary = {
    saleorApiUrl,
    updated: [],
    alreadyCurrent: [],
    missing: [],
    failed: [],
  };

  const client = createGraphQLClient(saleorApiUrl, token);
  const result = await client.query(AppWebhooksQuery, {}).toPromise();

  if (result.error || !result.data?.app) {
    logger.error(`Could not read app webhooks for ${saleorApiUrl}`, {
      error: result.error?.message ?? "no app in response (token may be invalid or app uninstalled)",
    });
    summary.failed.push("(could not read app webhooks)");

    return summary;
  }

  const existingWebhooks: Array<{ id: string; name: string; subscriptionQuery: string | null }> =
    result.data.app.webhooks ?? [];

  for (const declared of declaredWebhooks) {
    const existing = existingWebhooks.find((webhook) => webhook.name === declared.name);

    if (!existing) {
      /*
       * Deliberately not created here — see the header. An install missing a
       * payment webhook entirely is a different (and worse) problem than a
       * stale query, and it needs a human to look at it.
       */
      logger.warn(`Webhook not present on install — NOT created by this script: ${declared.name}`, {
        saleorApiUrl,
      });
      summary.missing.push(declared.name);
      continue;
    }

    if (normalize(existing.subscriptionQuery) === normalize(declared.query)) {
      summary.alreadyCurrent.push(declared.name);
      continue;
    }

    if (!apply) {
      logger.info(`WOULD UPDATE subscription query: ${declared.name}`, {
        saleorApiUrl,
        webhookId: existing.id,
        storedQueryChars: existing.subscriptionQuery?.length ?? 0,
        codeQueryChars: declared.query.length,
      });
      summary.updated.push(declared.name);
      continue;
    }

    const updateResult = await client
      .mutation(WebhookUpdateQueryMutation, { id: existing.id, query: declared.query })
      .toPromise();

    const errors = updateResult.data?.webhookUpdate?.errors ?? [];

    if (updateResult.error || errors.length > 0) {
      logger.error(`Failed to update subscription query: ${declared.name}`, {
        saleorApiUrl,
        webhookId: existing.id,
        error: updateResult.error?.message ?? JSON.stringify(errors),
      });
      summary.failed.push(declared.name);
      continue;
    }

    logger.info(`Updated subscription query: ${declared.name}`, {
      saleorApiUrl,
      webhookId: existing.id,
    });
    summary.updated.push(declared.name);
  }

  return summary;
};

const run = async () => {
  logger.info(
    apply
      ? "Applying subscription-query updates (webhookUpdate only — nothing is created or deleted)"
      : "Reporting subscription-query drift only. Re-run with --apply to write.",
  );

  const installs = await saleorApp.apl.getAll().catch((error: unknown) => {
    logger.error("Could not fetch installs from the APL", {
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });

  const targets = saleorApiUrlArg
    ? installs.filter((install) => install.saleorApiUrl === saleorApiUrlArg)
    : installs;

  if (!targets.length) {
    logger.error(
      saleorApiUrlArg
        ? `No install in the APL matches ${saleorApiUrlArg}`
        : "The APL has no installs",
    );
    process.exit(1);
  }

  const summaries: RepairSummary[] = [];

  for (const install of targets) {
    logger.info(`Checking ${install.saleorApiUrl}`);
    summaries.push(await repairInstall(install.saleorApiUrl, install.token));
  }

  for (const summary of summaries) {
    logger.info(`Summary for ${summary.saleorApiUrl} (${apply ? "applied" : "dry run"})`, {
      changed: summary.updated,
      alreadyCurrent: summary.alreadyCurrent,
      missingFromInstall: summary.missing,
      failed: summary.failed,
    });
  }

  const anyFailed = summaries.some((summary) => summary.failed.length > 0);

  process.exit(anyFailed ? 1 : 0);
};

run();
