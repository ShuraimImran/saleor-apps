/**
 * Payment Method Preferences
 *
 * A merchant's explicit choice to enable/disable a PayPal payment method,
 * stored independently of PayPal's capability (readiness) flags.
 *
 * Two distinct concepts are combined here:
 *  - capability / readiness: whether PayPal *allows* a method for this merchant
 *  - preference: whether the merchant has *turned the method on* in the admin UI
 *
 * The effective state shown at checkout is:
 *
 *   effectiveEnabled(method) = paypalAllows(method) AND merchantPreference(method)
 *
 * A preference value of `null` means "not explicitly set" and resolves to the
 * default below. The defaults make every method enabled once PayPal allows it,
 * EXCEPT Apple Pay, which must be opted into explicitly.
 */

/**
 * Default preference applied when a merchant has not made an explicit choice
 * (stored value is NULL). All methods default to enabled except Apple Pay.
 */
export const PAYMENT_METHOD_PREFERENCE_DEFAULTS = {
  paypalButtons: true,
  card: true,
  applePay: false,
  googlePay: true,
} as const;

export type PaymentMethodPreferenceKey = keyof typeof PAYMENT_METHOD_PREFERENCE_DEFAULTS;

/**
 * Resolve a stored preference value, falling back to the default when unset (NULL).
 */
export const resolvePreference = (
  key: PaymentMethodPreferenceKey,
  value: boolean | null | undefined,
): boolean => value ?? PAYMENT_METHOD_PREFERENCE_DEFAULTS[key];

/**
 * Stored preference columns from the merchant onboarding record.
 * `null` means the merchant has not made an explicit choice.
 */
export interface StoredPaymentMethodPreferences {
  prefPaypalButtons: boolean | null;
  prefCard: boolean | null;
  prefApplePay: boolean | null;
  prefGooglePay: boolean | null;
}

/**
 * PayPal capability (readiness) flags for the four configurable checkout methods.
 */
export interface PaymentMethodCapability {
  paypalButtons: boolean;
  advancedCardProcessing: boolean;
  applePay: boolean;
  googlePay: boolean;
}

/** Human-readable labels keyed by the preference/mutation key. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethodPreferenceKey, string> = {
  paypalButtons: "PayPal Buttons",
  card: "Card Processing",
  applePay: "Apple Pay",
  googlePay: "Google Pay",
};

/**
 * A preference change request, keyed by the mutation/preference key.
 * `undefined` means the method is left unchanged.
 */
export interface PaymentMethodPreferenceInput {
  paypalButtons?: boolean;
  card?: boolean;
  applePay?: boolean;
  googlePay?: boolean;
}

/** Capability flags keyed by the preference/mutation key (note: `card`, not `advancedCardProcessing`). */
export interface PaymentMethodCapabilityByKey {
  paypalButtons: boolean;
  card: boolean;
  applePay: boolean;
  googlePay: boolean;
}

/**
 * Guard for the "only PayPal-allowed methods can be enabled" rule.
 * Returns the keys of any methods the request tries to enable that PayPal
 * does not currently allow. An empty array means the request is valid.
 */
export const findDisallowedEnabledMethods = (
  input: PaymentMethodPreferenceInput,
  capability: PaymentMethodCapabilityByKey,
): PaymentMethodPreferenceKey[] =>
  (Object.keys(PAYMENT_METHOD_PREFERENCE_DEFAULTS) as PaymentMethodPreferenceKey[]).filter(
    (method) => input[method] === true && !capability[method],
  );

/**
 * Compute the effective enabled state for each method:
 * a method is enabled only when PayPal allows it AND the merchant preference is on.
 */
export const resolveEffectivePaymentMethods = (
  capability: PaymentMethodCapability,
  prefs: StoredPaymentMethodPreferences,
): PaymentMethodCapability => ({
  paypalButtons:
    capability.paypalButtons && resolvePreference("paypalButtons", prefs.prefPaypalButtons),
  advancedCardProcessing:
    capability.advancedCardProcessing && resolvePreference("card", prefs.prefCard),
  applePay: capability.applePay && resolvePreference("applePay", prefs.prefApplePay),
  googlePay: capability.googlePay && resolvePreference("googlePay", prefs.prefGooglePay),
});
