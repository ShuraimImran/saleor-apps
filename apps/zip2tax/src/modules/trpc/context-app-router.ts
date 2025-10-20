import { AuthData } from "@saleor/app-sdk/APL";
import { SALEOR_API_URL_HEADER, SALEOR_AUTHORIZATION_BEARER_HEADER } from "@saleor/app-sdk/headers";
import { inferAsyncReturnType } from "@trpc/server";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export const createTrpcContextAppRouter = async ({ req }: FetchCreateContextFnOptions) => {
  const saleorApiUrl = req.headers.get(SALEOR_API_URL_HEADER);
  const token = req.headers.get(SALEOR_AUTHORIZATION_BEARER_HEADER);
  const referer = req.headers.get("referer");

  // Extract app ID from referer URL if present (for development)
  let appId = "flat-tax-app"; // fallback
  if (referer) {
    const url = new URL(referer);
    const idParam = url.searchParams.get("id");
    if (idParam) {
      try {
        // Decode base64 app ID (e.g., "QXBwOjE2" -> "App:16")
        appId = Buffer.from(idParam, 'base64').toString('utf-8');
      } catch (e) {
        // If decoding fails, use the raw value
        appId = idParam;
      }
    }
  }

  const authData: AuthData | undefined = saleorApiUrl && token ? {
    saleorApiUrl,
    token,
    appId,
  } : undefined;

  return {
    authData,
  };
};

export type TrpcContextAppRouter = inferAsyncReturnType<typeof createTrpcContextAppRouter>;
