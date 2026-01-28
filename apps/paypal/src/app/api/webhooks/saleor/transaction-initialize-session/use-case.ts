import { err, ok, Result } from "neverthrow";

import {
  AppIsNotConfiguredResponse,
  BrokenAppResponse,
  MalformedRequestResponse,
} from "@/app/api/webhooks/saleor/saleor-webhook-responses";
import { TransactionInitializeSessionEventFragment } from "@/generated/graphql";
import { appContextContainer } from "@/lib/app-context";
import { BaseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { getPool } from "@/lib/database";
import { env } from "@/lib/env";
import { PayPalTenantConfigRepository } from "@/modules/app-config/repositories/paypal-tenant-config-repository";
import { PayPalConfigRepo } from "@/modules/paypal/configuration/paypal-config-repo";
import { createPayPalOrderId } from "@/modules/paypal/paypal-order-id";
import { IPayPalOrdersApiFactory, PayPalOrderItem } from "@/modules/paypal/types";
import { SaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { resolveSaleorMoneyFromPayPalOrder } from "@/modules/saleor/resolve-saleor-money-from-paypal-order";
import {
  getChannelIdFromRequestedEventPayload,
  getTransactionFromRequestedEventPayload,
} from "@/modules/saleor/transaction-requested-event-helpers";
import { mapPayPalErrorToApiError } from "@/modules/paypal/paypal-api-error";
import { createPayPalMoney } from "@/modules/paypal/paypal-money";
import {
  ChargeActionRequiredResult,
  AuthorizationActionRequiredResult,
} from "@/modules/transaction-result/action-required-result";
import {
  ChargeFailureResult,
  AuthorizationFailureResult,
} from "@/modules/transaction-result/failure-result";
import { GlobalPayPalConfigRepository } from "@/modules/wsm-admin/global-paypal-config-repository";
import {
  PostgresCustomerVaultRepository,
  ICustomerVaultRepository,
} from "@/modules/customer-vault/customer-vault-repository";

import {
  TransactionInitializeSessionUseCaseResponses,
  TransactionInitializeSessionUseCaseResponsesType,
} from "./use-case-response";

/**
 * Payment method type for vaulting
 * - "card": ACDC card vaulting (Phase 1)
 * - "paypal": PayPal wallet vaulting (Phase 2)
 * - "venmo": Venmo vaulting (Phase 2)
 * - "apple_pay": Apple Pay vaulting (Phase 2)
 */
type VaultingPaymentMethodType = "card" | "paypal" | "venmo" | "apple_pay";

/**
 * Vaulting data passed from frontend via transaction.data
 * Supports both ACDC Card Vaulting (Phase 1) and PayPal Wallet Vaulting (Phase 2)
 */
interface VaultingData {
  // Payment method type being vaulted
  // Defaults to "card" for backward compatibility with Phase 1
  paymentMethodType?: VaultingPaymentMethodType;
  // "Save During Purchase" flow - save payment method for future use
  savePaymentMethod?: boolean;
  // "Return Buyer" flow - use previously saved payment method
  vaultId?: string;
  // Saleor user ID (required for vaulting - logged-in users only)
  saleorUserId?: string;
  // MIT (Merchant-Initiated Transaction) - "Buyer Not Present" flow
  // When true, the transaction is initiated by the merchant without buyer interaction
  // Used for: subscriptions, delayed charges, reorders, etc.
  merchantInitiated?: boolean;
  // Idempotency key - prevents duplicate transactions on retry
  // Frontend should generate a unique key per checkout attempt (e.g., "checkout-{id}-{timestamp}")
  idempotencyKey?: string;
}

/**
 * Parse vaulting data from transaction event data
 */
function parseVaultingData(eventData: unknown): VaultingData {
  if (!eventData || typeof eventData !== "object") {
    return {};
  }

  const data = eventData as Record<string, unknown>;

  // Parse payment method type with validation
  let paymentMethodType: VaultingPaymentMethodType | undefined;
  if (typeof data.paymentMethodType === "string") {
    const validTypes: VaultingPaymentMethodType[] = ["card", "paypal", "venmo", "apple_pay"];
    if (validTypes.includes(data.paymentMethodType as VaultingPaymentMethodType)) {
      paymentMethodType = data.paymentMethodType as VaultingPaymentMethodType;
    }
  }

  return {
    paymentMethodType,
    savePaymentMethod: typeof data.savePaymentMethod === "boolean" ? data.savePaymentMethod : undefined,
    vaultId: typeof data.vaultId === "string" ? data.vaultId : undefined,
    saleorUserId: typeof data.saleorUserId === "string" ? data.saleorUserId : undefined,
    merchantInitiated: typeof data.merchantInitiated === "boolean" ? data.merchantInitiated : undefined,
    idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : undefined,
  };
}

/**
 * Helper function to extract and map line items from Saleor to PayPal format
 * IWT Requirement: Digital goods should use DIGITAL_GOODS category
 */
function extractPayPalItemsFromSource(
  sourceObject: TransactionInitializeSessionEventFragment["sourceObject"],
  currency: string,
  isDigital: boolean = false
): PayPalOrderItem[] {
  const items: PayPalOrderItem[] = [];

  if (sourceObject.__typename === "Checkout" && sourceObject.lines) {
    for (const line of sourceObject.lines) {
      if (!line.variant || !line.unitPrice) continue;

      const productName = line.variant.product?.name || line.variant.name || "Product";
      const variantName = line.variant.name;
      const fullName = variantName ? `${productName} - ${variantName}` : productName;

      // Use NET unit price (without tax) to match the item_total breakdown
      const unitAmount = line.unitPrice.net?.amount ?? line.unitPrice.gross.amount;

      items.push({
        name: fullName.substring(0, 127), // PayPal max 127 chars
        quantity: String(line.quantity),
        unit_amount: createPayPalMoney({
          currencyCode: currency,
          amount: unitAmount,
        }),
        sku: line.variant.sku || undefined,
        image_url: line.variant.product?.thumbnail?.url || undefined,
        category: isDigital ? "DIGITAL_GOODS" : "PHYSICAL_GOODS",
      });
    }
  } else if (sourceObject.__typename === "Order" && sourceObject.lines) {
    for (const line of sourceObject.lines) {
      if (!line.unitPrice) continue;

      const productName = line.productName || "Product";
      const variantName = line.variantName;
      const fullName = variantName ? `${productName} - ${variantName}` : productName;

      // Use NET unit price (without tax) to match the item_total breakdown
      const unitAmount = line.unitPrice.net?.amount ?? line.unitPrice.gross.amount;

      items.push({
        name: fullName.substring(0, 127), // PayPal max 127 chars
        quantity: String(line.quantity),
        unit_amount: createPayPalMoney({
          currencyCode: currency,
          amount: unitAmount,
        }),
        sku: line.productSku || undefined,
        image_url: line.thumbnail?.url || undefined,
        category: isDigital ? "DIGITAL_GOODS" : "PHYSICAL_GOODS",
      });
    }
  }

  return items;
}

/**
 * Helper function to extract amount breakdown from Saleor source object
 */
function extractAmountBreakdown(
  sourceObject: TransactionInitializeSessionEventFragment["sourceObject"]
) {
  let subtotal: number | undefined;
  let shipping: number | undefined;
  let taxTotal: number | undefined;

  if (sourceObject.__typename === "Checkout") {
    // Use NET amounts (without tax) for item_total and shipping
    subtotal = sourceObject.subtotalPrice?.net?.amount;
    shipping = sourceObject.shippingPrice?.net?.amount;
    // Calculate total tax (subtotal tax + shipping tax)
    const subtotalTax = sourceObject.subtotalPrice?.tax?.amount || 0;
    const shippingTax = sourceObject.shippingPrice?.tax?.amount || 0;
    taxTotal = subtotalTax + shippingTax;
  } else if (sourceObject.__typename === "Order") {
    // Use NET amounts (without tax) for item_total and shipping
    subtotal = sourceObject.subtotal?.net?.amount;
    shipping = sourceObject.shippingPrice?.net?.amount;
    // Calculate total tax (subtotal tax + shipping tax)
    const subtotalTax = sourceObject.subtotal?.tax?.amount || 0;
    const shippingTax = sourceObject.shippingPrice?.tax?.amount || 0;
    taxTotal = subtotalTax + shippingTax;
  }

  return {
    subtotal,
    shipping,
    taxTotal,
  };
}

/**
 * Helper function to extract buyer email from Saleor source object
 */
function extractBuyerEmail(
  sourceObject: TransactionInitializeSessionEventFragment["sourceObject"]
): string | undefined {
  if (sourceObject.__typename === "Checkout") {
    return sourceObject.email || undefined;
  } else if (sourceObject.__typename === "Order") {
    return sourceObject.userEmail || undefined;
  }
  return undefined;
}

const normalizeNationalNumber = (raw?: string | null) => {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 15) return undefined;
  return digits;
};

const normalizeSoftDescriptor = (raw?: string | null) => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 22);
};

/**
 * Helper function to extract shipping address from Saleor source object
 * Maps Saleor address format to PayPal address format
 */
function extractShippingAddress(
  sourceObject: TransactionInitializeSessionEventFragment["sourceObject"]
):
  | {
      name?: { full_name?: string };
      address?: {
        address_line_1?: string;
        address_line_2?: string;
        admin_area_2?: string;
        admin_area_1?: string;
        postal_code?: string;
        country_code?: string;
      };
      email_address?: string;
      phone_number?: { national_number?: string };
    }
  | undefined {
  const shippingAddress =
    sourceObject.__typename === "Checkout" || sourceObject.__typename === "Order"
      ? sourceObject.shippingAddress
      : null;

  if (!shippingAddress) {
    return undefined;
  }

  const fullName =
    `${shippingAddress.firstName || ""} ${shippingAddress.lastName || ""}`.trim() || undefined;

  const email = extractBuyerEmail(sourceObject);
  const normalizedPhone = normalizeNationalNumber(shippingAddress.phone);

  return {
    name: fullName ? { full_name: fullName } : undefined,
    address: {
      address_line_1: shippingAddress.streetAddress1 || undefined,
      address_line_2: shippingAddress.streetAddress2 || undefined,
      admin_area_2: shippingAddress.city || undefined, // City
      admin_area_1: shippingAddress.countryArea || undefined, // State/Province
      postal_code: shippingAddress.postalCode || undefined,
      country_code: shippingAddress.country?.code || undefined,
    },
    email_address: email,
    phone_number: normalizedPhone ? { national_number: normalizedPhone } : undefined,
  };
}

/**
 * Helper function to detect if the order contains only digital goods (no shipping required)
 * IWT Requirement: Digital goods should specify NO_SHIPPING
 *
 * Detection logic:
 * 1. Check if Checkout has isShippingRequired = false (if available)
 * 2. Or if there's no shipping address AND shipping price is 0/undefined
 */
function isDigitalGoodsOnly(
  sourceObject: TransactionInitializeSessionEventFragment["sourceObject"]
): boolean {
  if (sourceObject.__typename === "Checkout") {
    // Primary check: Saleor's isShippingRequired flag (most reliable, if available in fragment)
    const checkoutAny = sourceObject as Record<string, unknown>;
    if ("isShippingRequired" in checkoutAny && checkoutAny.isShippingRequired === false) {
      return true;
    }

    // Fallback: Check if no shipping address and no shipping price
    const hasShippingAddress = !!sourceObject.shippingAddress;
    const shippingPrice = sourceObject.shippingPrice?.gross?.amount ?? 0;

    // If no shipping address and no shipping cost, likely digital goods
    if (!hasShippingAddress && shippingPrice === 0) {
      return true;
    }
  } else if (sourceObject.__typename === "Order") {
    // For orders, check if shipping address is null and shipping price is 0
    const hasShippingAddress = !!sourceObject.shippingAddress;
    const shippingPrice = sourceObject.shippingPrice?.gross?.amount ?? 0;

    // If no shipping address and no shipping cost, likely digital goods
    if (!hasShippingAddress && shippingPrice === 0) {
      return true;
    }
  }

  return false;
}

/**
 * Helper function to build payer object for PayPal order
 * This is used to prefill buyer information in PayPal checkout
 */
function buildPayerObject(
  sourceObject: TransactionInitializeSessionEventFragment["sourceObject"]
):
  | {
      email_address?: string;
      phone?: {
        phone_type?: "FAX" | "HOME" | "MOBILE" | "OTHER" | "PAGER";
        phone_number?: { national_number: string };
      };
      name?: { given_name?: string; surname?: string };
    }
  | undefined {
  const email = extractBuyerEmail(sourceObject);
  const billingAddress =
    sourceObject.__typename === "Checkout" || sourceObject.__typename === "Order"
      ? sourceObject.billingAddress
      : null;

  if (!email && !billingAddress) {
    return undefined;
  }

  const normalizedPhone = normalizeNationalNumber(billingAddress?.phone);

  return {
    email_address: email,
    phone: normalizedPhone
      ? {
          phone_type: "MOBILE",
          phone_number: { national_number: normalizedPhone },
        }
      : undefined,
    name: billingAddress
      ? {
        given_name: billingAddress.firstName || undefined,
          surname: billingAddress.lastName || undefined,
        }
      : undefined,
  };
}

type UseCaseExecuteResult = Result<
  TransactionInitializeSessionUseCaseResponsesType,
  AppIsNotConfiguredResponse | BrokenAppResponse | MalformedRequestResponse
>;

export class TransactionInitializeSessionUseCase {
  private logger = createLogger("TransactionInitializeSessionUseCase");
  private paypalConfigRepo: PayPalConfigRepo;
  private paypalOrdersApiFactory: IPayPalOrdersApiFactory;

  constructor(deps: {
    paypalConfigRepo: PayPalConfigRepo;
    paypalOrdersApiFactory: IPayPalOrdersApiFactory;
  }) {
    this.paypalConfigRepo = deps.paypalConfigRepo;
    this.paypalOrdersApiFactory = deps.paypalOrdersApiFactory;
  }

  async execute(args: {
    authData: import("@saleor/app-sdk/APL").AuthData;
    event: TransactionInitializeSessionEventFragment;
  }): Promise<UseCaseExecuteResult> {
    const { authData, event } = args;
    const useCaseStartTime = Date.now();

    this.logger.info("Processing transaction initialize session event", {
      transactionId: event.transaction.id,
      actionType: event.action.actionType,
      amount: event.action.amount,
      currency: event.action.currency,
    });

    // Get channel ID from the event
    const channelId = event.sourceObject.channel.id;

    // Get PayPal configuration for this channel
    const configLoadStart = Date.now();
    const paypalConfigResult = await this.paypalConfigRepo.getPayPalConfig(authData, channelId);
    const configLoadTime = Date.now() - configLoadStart;

    this.logger.debug("PayPal config load timing", {
      config_load_time_ms: configLoadTime,
    });

    if (paypalConfigResult.isErr()) {
      this.logger.error("Failed to get PayPal configuration", {
        error: paypalConfigResult.error,
      });

      return err(
        new BrokenAppResponse(
          appContextContainer.getContextValue(),
          paypalConfigResult.error,
        ),
      );
    }

    if (!paypalConfigResult.value) {
      this.logger.warn("PayPal configuration not found for channel", {
        channelId,
      });

      return err(
        new AppIsNotConfiguredResponse(
          appContextContainer.getContextValue(),
          new BaseError("PayPal configuration not found for channel"),
        ),
      );
    }

    const config = paypalConfigResult.value;

    this.logger.debug("Loaded PayPal configuration", {
      hasClientId: !!config.clientId,
      hasClientSecret: !!config.clientSecret,
      environment: config.environment,
      hasMerchantEmail: !!config.merchantEmail,
      hasMerchantClientId: !!config.merchantClientId,
      hasMerchantId: !!config.merchantId,
      merchantEmail: config.merchantEmail,
    });

    // Set app context early so it's available even if errors occur later
    const appContext = {
      paypalEnv: config.environment || config.getPayPalEnvValue(),
    };
    appContextContainer.set(appContext);

    // Fetch BN code and partner fee percentage from global config
    let bnCode: string | undefined;
    let partnerMerchantId: string | undefined;
    let partnerFeePercent: number | undefined;
    const globalConfigLoadStart = Date.now();
    try {
      const pool = getPool();
      const globalConfigRepository = GlobalPayPalConfigRepository.create(pool);
      const globalConfigResult = await globalConfigRepository.getActiveConfig();

      if (globalConfigResult.isOk() && globalConfigResult.value) {
        const globalConfig = globalConfigResult.value;
        bnCode = globalConfig.bnCode || undefined;
        partnerMerchantId = globalConfig.partnerMerchantId || undefined;
        partnerFeePercent = globalConfig.partnerFeePercent || undefined;
        this.logger.debug("Retrieved config from global config", {
          hasBnCode: !!bnCode,
          hasPartnerMerchantId: !!partnerMerchantId,
          partnerFeePercent,
        });
      } else {
        this.logger.warn("No active global config found", {
          error: globalConfigResult.isErr() ? globalConfigResult.error : undefined,
        });
      }
    } catch (error) {
      this.logger.warn("Failed to fetch global config", {
        error,
      });
    }
    const globalConfigLoadTime = Date.now() - globalConfigLoadStart;

    this.logger.debug("Global config load timing", {
      global_config_load_time_ms: globalConfigLoadTime,
    });

    // Create PayPal orders API instance with merchant context
    const paypalOrdersApi = this.paypalOrdersApiFactory.create({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      merchantId: config.merchantId ? (config.merchantId as any) : undefined,
      merchantEmail: config.merchantEmail || undefined,
      bnCode,
      env: config.environment,
    });

    // Validate and convert amount
    if (typeof event.action.amount !== "number" || event.action.amount == null) {
      this.logger.error("Invalid amount in transaction event", {
        amount: event.action.amount,
        transactionId: event.transaction.id,
      });

      return err(
        new MalformedRequestResponse(
          appContextContainer.getContextValue(),
          new BaseError("Invalid amount in transaction event"),
        ),
      );
    }

    if (event.action.amount < 0) {
      this.logger.error("Amount must be greater than or equal to 0", {
        amount: event.action.amount,
        transactionId: event.transaction.id,
      });

      return err(
        new MalformedRequestResponse(
          appContextContainer.getContextValue(),
          new BaseError("Amount must be greater than or equal to 0"),
        ),
      );
    }

    // Convert Saleor money to PayPal money format
    const paypalMoney = createPayPalMoney({
      currencyCode: event.action.currency,
      amount: event.action.amount,
    });

    // Log the source object to debug line items
    this.logger.debug("Source object for line items extraction", {
      typename: event.sourceObject.__typename,
      sourceObjectId: event.sourceObject.id,
      hasLines: "lines" in event.sourceObject,
      linesCount: "lines" in event.sourceObject ? (event.sourceObject.lines?.length || 0) : "N/A",
      sourceObject: JSON.stringify(event.sourceObject, null, 2),
    });

    // IWT Requirement: Detect digital goods for item categorization
    const digitalGoodsOnly = isDigitalGoodsOnly(event.sourceObject);

    // Extract line items from source object (Checkout or Order)
    const paypalItems = extractPayPalItemsFromSource(event.sourceObject, event.action.currency, digitalGoodsOnly);

    // Extract amount breakdown (subtotal, shipping)
    const breakdown = extractAmountBreakdown(event.sourceObject);

    this.logger.debug("Extracted line items and breakdown for PayPal order", {
      itemCount: paypalItems.length,
      items: paypalItems.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        sku: item.sku,
        unitAmount: item.unit_amount,
      })),
      breakdown: {
        subtotal: breakdown.subtotal,
        shipping: breakdown.shipping,
        taxTotal: breakdown.taxTotal,
        total: event.action.amount,
      },
    });

    // Calculate platform fee if configured
    let platformFees: Array<{ amount: typeof paypalMoney; payee?: { merchant_id: string } }> | undefined;
    if (partnerFeePercent && partnerFeePercent > 0 && config.merchantId && partnerMerchantId) {
      const feeAmount = event.action.amount * (partnerFeePercent / 100);
      const platformFeeMoney = createPayPalMoney({
        currencyCode: event.action.currency,
        amount: feeAmount,
      });

      // Platform fee payee is optional - if not specified, PayPal uses the partner's merchant ID
      // from the authentication context
      platformFees = [{
        amount: platformFeeMoney,
      }];

      this.logger.debug("Calculated platform fee", {
        partnerFeePercent,
        feeAmount,
        platformFeeMoney,
      });
    }

    // Determine PayPal intent based on action type
    const intent = event.action.actionType === "CHARGE" ? "CAPTURE" : "AUTHORIZE";

    this.logger.debug("Creating PayPal order", {
      intent,
      amount: paypalMoney,
      itemsCount: paypalItems.length,
      hasPlatformFees: !!platformFees,
      payeeMerchantId: config.merchantId,
      transactionId: event.transaction.id,
    });

    // Extract buyer and shipping information for PayPal
    const buyerEmail = extractBuyerEmail(event.sourceObject);
    const payer = buildPayerObject(event.sourceObject);
    const shipping = extractShippingAddress(event.sourceObject);

    let softDescriptor: string | undefined;
    try {
      const tenantConfigRepository = PayPalTenantConfigRepository.create(getPool());
      const tenantConfigResult = await tenantConfigRepository.getBySaleorApiUrl(
        authData.saleorApiUrl,
      );

      if (tenantConfigResult.isErr()) {
        this.logger.warn("Failed to load tenant soft descriptor", {
          error: tenantConfigResult.error,
        });
      } else {
        const rawSoftDescriptor = tenantConfigResult.value?.softDescriptor;
        const normalizedSoftDescriptor = normalizeSoftDescriptor(rawSoftDescriptor);

        if (rawSoftDescriptor !== undefined && rawSoftDescriptor !== null) {
          if (normalizedSoftDescriptor) {
            this.logger.info("Soft descriptor applied", {
              length: normalizedSoftDescriptor.length,
            });
          } else {
            this.logger.warn("Soft descriptor skipped due to validation", {
              length: rawSoftDescriptor.trim().length,
            });
          }
        }

        softDescriptor = normalizedSoftDescriptor;
      }
    } catch (error) {
      this.logger.warn("Failed to resolve tenant soft descriptor", {
        error,
      });
    }

    // IWT Requirement: Detect digital goods and set appropriate shipping preference
    this.logger.debug("Digital goods detection", {
      digitalGoodsOnly,
      hasShippingAddress: !!shipping,
      sourceType: event.sourceObject.__typename,
    });

    // Build experience context for PayPal checkout flow
    // This controls the PayPal checkout experience (branding, return URLs, etc.)
    // IWT Requirement: Digital goods should specify NO_SHIPPING
    const experienceContext = {
      brand_name: env.APP_NAME || "Store",
      user_action: "PAY_NOW" as const, // Show "Pay Now" instead of "Continue"
      shipping_preference: digitalGoodsOnly
        ? ("NO_SHIPPING" as const)
        : shipping
          ? ("SET_PROVIDED_ADDRESS" as const)
          : ("GET_FROM_FILE" as const),
    };

    // Build payment source configuration
    // This enables callbacks for shipping address changes and other checkout updates
    // IWT Requirement: app_switch_preference enables native PayPal app checkout on mobile
    let paymentSource: {
      paypal?: {
        experience_context?: any;
        // PayPal Wallet Vaulting - "Return Buyer" flow (Phase 2)
        vault_id?: string;
        // PayPal Wallet Vaulting - "Save During Purchase" flow (Phase 2)
        attributes?: {
          vault?: {
            store_in_vault: "ON_SUCCESS";
            usage_type?: "MERCHANT" | "PLATFORM";
          };
          customer?: { id: string };
        };
      };
      card?: {
        vault_id?: string;
        attributes?: {
          vault?: { store_in_vault: "ON_SUCCESS" };
          customer?: { id: string };
          verification?: { method: "SCA_WHEN_REQUIRED" | "SCA_ALWAYS" };
        };
        // MIT (Merchant-Initiated Transaction) - stored credential for "Buyer Not Present" flow
        stored_credential?: {
          payment_initiator: "CUSTOMER" | "MERCHANT";
          payment_type: "ONE_TIME" | "RECURRING" | "UNSCHEDULED";
          usage: "FIRST" | "SUBSEQUENT" | "DERIVED";
        };
      };
      venmo?: {
        experience_context?: {
          brand_name?: string;
          shipping_preference?: "GET_FROM_FILE" | "NO_SHIPPING" | "SET_PROVIDED_ADDRESS";
        };
        // Venmo Vaulting - "Return Buyer" flow (Phase 2)
        vault_id?: string;
        // Venmo Vaulting - "Save During Purchase" flow (Phase 2)
        attributes?: {
          vault?: {
            store_in_vault: "ON_SUCCESS";
            usage_type?: "MERCHANT" | "PLATFORM";
          };
          customer?: { id: string };
        };
      };
      apple_pay?: {
        // Apple Pay Vaulting - "Return Buyer" flow (Phase 2)
        vault_id?: string;
        // Apple Pay Vaulting - "Save During Purchase" flow (Phase 2)
        attributes?: {
          vault?: {
            store_in_vault: "ON_SUCCESS";
            usage_type?: "MERCHANT" | "PLATFORM";
          };
          customer?: { id: string };
        };
        // Apple Pay MIT - stored credential for recurring/unscheduled payments
        stored_credential?: {
          payment_initiator: "CUSTOMER" | "MERCHANT";
          payment_type: "ONE_TIME" | "RECURRING" | "UNSCHEDULED";
          usage: "FIRST" | "SUBSEQUENT" | "DERIVED";
        };
      };
    } | undefined = env.APP_API_BASE_URL
      ? {
          paypal: {
            experience_context: {
              ...experienceContext,
              // IWT Requirement: Enable app switch for mobile checkout
              // When true, allows PayPal to switch to the native PayPal app if installed
              app_switch_preference: true,
              callback_configuration: {
                callback_url: `${env.APP_API_BASE_URL}/api/webhooks/paypal/order-update-callback`,
                callback_events: [
                  "SHIPPING_CHANGE",
                  "SHIPPING_OPTIONS_CHANGE",
                  "BILLING_ADDRESS_CHANGE",
                  "PHONE_NUMBER_CHANGE",
                ] as Array<"SHIPPING_CHANGE" | "SHIPPING_OPTIONS_CHANGE" | "BILLING_ADDRESS_CHANGE" | "PHONE_NUMBER_CHANGE">,
              },
            },
          },
        }
      : {
          // Even without callback URL, set app_switch_preference for IWT compliance
          paypal: {
            experience_context: {
              ...experienceContext,
              app_switch_preference: true,
            },
          },
        };

    // ========================================
    // Payment Method Vaulting
    // Phase 1: Card (ACDC)
    // Phase 2: PayPal Wallet, Venmo, Apple Pay
    // ========================================
    // Parse vaulting data from event.data (passed by frontend)
    const vaultingData = parseVaultingData((event as any).data);
    let vaultCustomerId: string | undefined;

    // Default to "card" for backward compatibility with Phase 1
    const paymentMethodType = vaultingData.paymentMethodType || "card";

    this.logger.debug("Vaulting data from event", {
      paymentMethodType,
      savePaymentMethod: vaultingData.savePaymentMethod,
      hasVaultId: !!vaultingData.vaultId,
      hasSaleorUserId: !!vaultingData.saleorUserId,
      merchantInitiated: vaultingData.merchantInitiated,
      hasIdempotencyKey: !!vaultingData.idempotencyKey,
    });

    // "Return Buyer" flow - use previously saved payment method
    if (vaultingData.vaultId) {
      const isMIT = vaultingData.merchantInitiated === true;

      this.logger.info("Return Buyer flow - using vaulted payment method", {
        paymentMethodType,
        vaultId: vaultingData.vaultId,
        merchantInitiated: isMIT,
        flow: isMIT ? "Buyer Not Present (MIT)" : "Buyer Present",
      });

      if (!paymentSource) {
        paymentSource = {};
      }

      if (paymentMethodType === "paypal") {
        // PayPal Wallet Vaulting - "Return Buyer" flow (Phase 2)
        // Use vault_id in payment_source.paypal
        paymentSource.paypal = {
          ...paymentSource.paypal,
          vault_id: vaultingData.vaultId,
        };

        this.logger.info("PayPal wallet vault_id added to payment source", {
          vaultId: vaultingData.vaultId,
        });

        // Note: MIT for PayPal wallets is handled differently than cards
        // PayPal wallet doesn't use stored_credential, the vault_id itself implies consent
        if (isMIT) {
          this.logger.info("PayPal Wallet MIT - vault_id used for merchant-initiated transaction", {
            vaultId: vaultingData.vaultId,
          });
        }
      } else if (paymentMethodType === "venmo") {
        // Venmo Vaulting - "Return Buyer" flow (Phase 2)
        // Use vault_id in payment_source.venmo
        paymentSource.venmo = {
          vault_id: vaultingData.vaultId,
        };

        this.logger.info("Venmo vault_id added to payment source", {
          vaultId: vaultingData.vaultId,
        });

        // Note: MIT for Venmo is similar to PayPal wallets
        // The vault_id itself implies consent for merchant-initiated transactions
        if (isMIT) {
          this.logger.info("Venmo MIT - vault_id used for merchant-initiated transaction", {
            vaultId: vaultingData.vaultId,
          });
        }
      } else if (paymentMethodType === "apple_pay") {
        // Apple Pay Vaulting - "Return Buyer" flow (Phase 2)
        // Use vault_id in payment_source.apple_pay
        paymentSource.apple_pay = {
          vault_id: vaultingData.vaultId,
        };

        this.logger.info("Apple Pay vault_id added to payment source", {
          vaultId: vaultingData.vaultId,
        });

        // MIT for Apple Pay requires stored_credential similar to cards
        if (isMIT) {
          paymentSource.apple_pay = {
            ...paymentSource.apple_pay,
            stored_credential: {
              payment_initiator: "MERCHANT" as const,
              payment_type: "UNSCHEDULED" as const,
              usage: "SUBSEQUENT" as const,
            },
          };

          this.logger.info("MIT stored_credential added to Apple Pay payment source", {
            payment_initiator: "MERCHANT",
            payment_type: "UNSCHEDULED",
            usage: "SUBSEQUENT",
          });
        }
      } else {
        // ACDC Card Vaulting - "Return Buyer" flow (Phase 1)
        // Use vault_id in payment_source.card
        paymentSource.card = {
          vault_id: vaultingData.vaultId,
        };

        // MIT (Merchant-Initiated Transaction) - add stored_credential for "Buyer Not Present" flow
        // This is required when charging a saved card without buyer interaction
        // (e.g., subscriptions, delayed charges, reorders)
        if (isMIT) {
          paymentSource.card = {
            ...paymentSource.card,
            stored_credential: {
              payment_initiator: "MERCHANT" as const,
              payment_type: "UNSCHEDULED" as const,
              usage: "SUBSEQUENT" as const,
            },
          };

          this.logger.info("MIT stored_credential added to card payment source", {
            payment_initiator: "MERCHANT",
            payment_type: "UNSCHEDULED",
            usage: "SUBSEQUENT",
          });
        }
      }
    }

    // "Save During Purchase" flow - save payment method for future use
    if (vaultingData.savePaymentMethod && vaultingData.saleorUserId) {
      this.logger.info("Save During Purchase flow - will vault payment method on success", {
        paymentMethodType,
        saleorUserId: vaultingData.saleorUserId,
      });

      try {
        // Get or create customer vault mapping
        const customerVaultRepo = PostgresCustomerVaultRepository.create(getPool());
        const customerVaultResult = await customerVaultRepo.getOrCreate(
          authData.saleorApiUrl,
          vaultingData.saleorUserId
        );

        if (customerVaultResult.isOk()) {
          vaultCustomerId = customerVaultResult.value.paypalCustomerId;
          this.logger.info("Customer vault mapping ready", {
            saleorUserId: vaultingData.saleorUserId,
            paypalCustomerId: vaultCustomerId,
          });

          // For PayPal wallet vaulting, add attributes to payment_source.paypal
          if (paymentMethodType === "paypal" && vaultCustomerId) {
            if (!paymentSource) {
              paymentSource = {};
            }
            if (!paymentSource.paypal) {
              paymentSource.paypal = {};
            }

            // Add vault attributes for PayPal wallet vaulting (Phase 2)
            paymentSource.paypal.attributes = {
              vault: {
                store_in_vault: "ON_SUCCESS" as const,
                usage_type: "MERCHANT" as const,
              },
              customer: {
                id: vaultCustomerId,
              },
            };

            this.logger.info("PayPal wallet vault attributes added to payment source", {
              customerId: vaultCustomerId,
              storeInVault: "ON_SUCCESS",
              usageType: "MERCHANT",
            });

            // Clear vaultCustomerId to prevent duplicate handling in createOrder
            // (PayPal wallet vaulting is handled via paymentSource.paypal.attributes,
            // not via the vaultCustomerId parameter which is for card vaulting)
            vaultCustomerId = undefined;
          }

          // For Venmo vaulting, add attributes to payment_source.venmo
          if (paymentMethodType === "venmo" && vaultCustomerId) {
            if (!paymentSource) {
              paymentSource = {};
            }

            // Add vault attributes for Venmo vaulting (Phase 2)
            paymentSource.venmo = {
              attributes: {
                vault: {
                  store_in_vault: "ON_SUCCESS" as const,
                  usage_type: "MERCHANT" as const,
                },
                customer: {
                  id: vaultCustomerId,
                },
              },
            };

            this.logger.info("Venmo vault attributes added to payment source", {
              customerId: vaultCustomerId,
              storeInVault: "ON_SUCCESS",
              usageType: "MERCHANT",
            });

            // Clear vaultCustomerId to prevent duplicate handling in createOrder
            vaultCustomerId = undefined;
          }

          // For Apple Pay vaulting, add attributes to payment_source.apple_pay
          if (paymentMethodType === "apple_pay" && vaultCustomerId) {
            if (!paymentSource) {
              paymentSource = {};
            }

            // Add vault attributes for Apple Pay vaulting (Phase 2)
            paymentSource.apple_pay = {
              attributes: {
                vault: {
                  store_in_vault: "ON_SUCCESS" as const,
                  usage_type: "MERCHANT" as const,
                },
                customer: {
                  id: vaultCustomerId,
                },
              },
            };

            this.logger.info("Apple Pay vault attributes added to payment source", {
              customerId: vaultCustomerId,
              storeInVault: "ON_SUCCESS",
              usageType: "MERCHANT",
            });

            // Clear vaultCustomerId to prevent duplicate handling in createOrder
            vaultCustomerId = undefined;
          }

          // For ACDC Card (hosted CardFields), vaulting is handled entirely
          // by the PayPal JS SDK via the data-user-id-token attribute.
          // Do NOT pass vaultCustomerId to createOrder — that would add
          // payment_source.card.attributes (vault/customer/verification)
          // which is only valid for server-side card submission where
          // the card number and expiry are included in the request body.
          // The customer vault mapping is still needed so that
          // PaymentGatewayInitialize can generate a userIdToken.
          if (paymentMethodType === "card" && vaultCustomerId) {
            this.logger.info("ACDC hosted fields: vault handled by SDK via data-user-id-token, clearing vaultCustomerId", {
              paypalCustomerId: vaultCustomerId,
            });
            vaultCustomerId = undefined;
          }
        } else {
          this.logger.warn("Failed to get/create customer vault mapping, proceeding without vaulting", {
            error: customerVaultResult.error,
          });
        }
      } catch (error) {
        this.logger.warn("Error in customer vault mapping, proceeding without vaulting", {
          error,
        });
      }
    } else if (vaultingData.savePaymentMethod && !vaultingData.saleorUserId) {
      this.logger.warn("savePaymentMethod requested but no saleorUserId provided - vaulting requires logged-in user");
    }

    // PayPal only allows ONE payment_source type per request.
    // For ACDC CardFields, the SDK handles card data client-side,
    // so we must NOT send payment_source.paypal for card payments.
    // Otherwise PayPal returns INVALID_REQUEST error.
    if (paymentSource) {
      if (paymentMethodType === "card") {
        // ACDC CardFields: remove all non-card payment sources.
        // The CardFields SDK submits card data directly to PayPal.
        // Backend only needs payment_source.card when vaulting (attributes).
        delete paymentSource.paypal;
        delete paymentSource.venmo;
        delete paymentSource.apple_pay;
        // If nothing remains, clear paymentSource entirely so
        // PayPal creates a plain order (CardFields will attach card later)
        if (Object.keys(paymentSource).length === 0) {
          paymentSource = undefined;
        }
        this.logger.debug("Cleaned payment_source for card (ACDC) payment", {
          hasPaymentSource: !!paymentSource,
          hasCardSource: !!paymentSource?.card,
          hasVaultCustomerId: !!vaultCustomerId,
        });
      } else if (paymentMethodType === "venmo") {
        delete paymentSource.paypal;
        delete paymentSource.card;
        delete paymentSource.apple_pay;
        if (Object.keys(paymentSource).length === 0) {
          paymentSource = undefined;
        }
        this.logger.debug("Cleaned payment_source for venmo payment");
      } else if (paymentMethodType === "apple_pay") {
        delete paymentSource.paypal;
        delete paymentSource.card;
        delete paymentSource.venmo;
        if (Object.keys(paymentSource).length === 0) {
          paymentSource = undefined;
        }
        this.logger.debug("Cleaned payment_source for apple_pay payment");
      }
    }

    // Create PayPal order
    const createOrderStart = Date.now();
    const createOrderResult = await paypalOrdersApi.createOrder({
      amount: paypalMoney,
      intent,
      payeeMerchantId: config.merchantId || undefined,
      items: paypalItems.length > 0 ? paypalItems : undefined,
      amountBreakdown: paypalItems.length > 0 ? {
        itemTotal: breakdown.subtotal,
        shipping: breakdown.shipping,
        taxTotal: breakdown.taxTotal,
      } : undefined,
      platformFees,
      metadata: {
        saleor_transaction_id: event.transaction.id,
        saleor_source_id: event.sourceObject.id,
        saleor_source_type: event.sourceObject.__typename,
        saleor_channel_id: channelId,
      },
      // PayPal certification-required parameters
      payer,
      shipping,
      softDescriptor,
      paymentSource,
      // ACDC Card Vaulting - customer ID for "Save During Purchase" flow
      vaultCustomerId,
      // Idempotency key - prevents duplicate transactions on network retry
      requestId: vaultingData.idempotencyKey,
    });
    const createOrderTime = Date.now() - createOrderStart;
    const totalUseCaseTime = Date.now() - useCaseStartTime;

    this.logger.info("Transaction initialization timing breakdown", {
      config_load_time_ms: configLoadTime,
      global_config_load_time_ms: globalConfigLoadTime,
      create_order_time_ms: createOrderTime,
      total_use_case_time_ms: totalUseCaseTime,
      other_processing_time_ms: totalUseCaseTime - configLoadTime - globalConfigLoadTime - createOrderTime,
    });

    if (createOrderResult.isErr()) {
      const error = mapPayPalErrorToApiError(createOrderResult.error);
      
      this.logger.error("Failed to create PayPal order", {
        error,
      });

      const failureResult = event.action.actionType === "CHARGE" 
        ? new ChargeFailureResult()
        : new AuthorizationFailureResult();

      return ok(
        new TransactionInitializeSessionUseCaseResponses.Failure({
          transactionResult: failureResult,
          error,
          appContext: appContextContainer.getContextValue(),
        }),
      );
    }

    const paypalOrder = createOrderResult.value;

    // Log the full PayPal order response
    this.logger.info("Successfully created PayPal order - Full Response", {
      paypalOrderId: paypalOrder.id,
      status: paypalOrder.status,
      fullResponse: JSON.stringify(paypalOrder, null, 2),
    });

    // Log purchase units details if available
    if (paypalOrder.purchase_units && paypalOrder.purchase_units.length > 0) {
      this.logger.info("PayPal order purchase units details", {
        purchaseUnits: paypalOrder.purchase_units.map((unit) => ({
          amount: unit.amount,
          itemsCount: unit.items?.length || 0,
          items: unit.items || [],
          hasPlatformFees: !!unit.payment_instruction?.platform_fees,
          platformFees: unit.payment_instruction?.platform_fees || [],
        })),
      });
    }

    // Check if order requires payer action (e.g., approval)
    if (paypalOrder.status === "PAYER_ACTION_REQUIRED" || paypalOrder.status === "CREATED") {
      const actionRequiredResult = event.action.actionType === "CHARGE"
        ? new ChargeActionRequiredResult()
        : new AuthorizationActionRequiredResult();

      return ok(
        new TransactionInitializeSessionUseCaseResponses.ActionRequired({
          transactionResult: actionRequiredResult,
          paypalOrderId: createPayPalOrderId(paypalOrder.id),
          data: {
            client_token: null, // PayPal doesn't use client tokens like Stripe
            paypal_order_id: paypalOrder.id,
            environment: config.environment,
            // ACDC Card Vaulting status
            vaulting: {
              enabled: !!vaultCustomerId,
              customerId: vaultCustomerId || null,
              isReturnBuyer: !!vaultingData.vaultId,
            },
          },
          appContext: appContextContainer.getContextValue(),
        }),
      );
    }

    // If order is already approved, we can proceed
    const saleorMoneyResult = resolveSaleorMoneyFromPayPalOrder(paypalOrder);

    if (saleorMoneyResult.isErr()) {
      this.logger.error("Failed to resolve Saleor money from PayPal order", {
        error: saleorMoneyResult.error,
      });

      return err(
        new BrokenAppResponse(
          appContextContainer.getContextValue(),
          saleorMoneyResult.error,
        ),
      );
    }

    // Create appropriate success result
    const successResult = event.action.actionType === "CHARGE"
      ? new ChargeActionRequiredResult()
      : new AuthorizationActionRequiredResult();

    return ok(
      new TransactionInitializeSessionUseCaseResponses.Success({
        transactionResult: successResult,
        paypalOrderId: createPayPalOrderId(paypalOrder.id),
        saleorMoney: saleorMoneyResult.value,
        appContext: appContextContainer.getContextValue(),
      }),
    );
  }
}
