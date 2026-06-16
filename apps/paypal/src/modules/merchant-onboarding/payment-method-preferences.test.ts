import { describe, expect, it } from "vitest";

import {
  findDisallowedEnabledMethods,
  PAYMENT_METHOD_PREFERENCE_DEFAULTS,
  PaymentMethodCapability,
  PaymentMethodCapabilityByKey,
  resolveEffectivePaymentMethods,
  resolvePreference,
  StoredPaymentMethodPreferences,
} from "./payment-method-preferences";

/*
 * Core invariant under test:
 *
 *   effectiveEnabled(method) = paypalAllows(method) AND merchantPreference(method)
 *
 * with an unset (null) preference resolving to the default — all methods on
 * EXCEPT Apple Pay, which must be opted into explicitly.
 */

const ALL_ALLOWED: PaymentMethodCapability = {
  paypalButtons: true,
  advancedCardProcessing: true,
  applePay: true,
  googlePay: true,
};

const NONE_ALLOWED: PaymentMethodCapability = {
  paypalButtons: false,
  advancedCardProcessing: false,
  applePay: false,
  googlePay: false,
};

const NO_PREFERENCES: StoredPaymentMethodPreferences = {
  prefPaypalButtons: null,
  prefCard: null,
  prefApplePay: null,
  prefGooglePay: null,
};

describe("PAYMENT_METHOD_PREFERENCE_DEFAULTS", () => {
  it("defaults every method on except Apple Pay", () => {
    expect(PAYMENT_METHOD_PREFERENCE_DEFAULTS).toStrictEqual({
      paypalButtons: true,
      card: true,
      applePay: false,
      googlePay: true,
    });
  });
});

describe("resolvePreference", () => {
  it("falls back to the default when the stored value is null", () => {
    expect(resolvePreference("paypalButtons", null)).toBe(true);
    expect(resolvePreference("card", null)).toBe(true);
    expect(resolvePreference("googlePay", null)).toBe(true);
    expect(resolvePreference("applePay", null)).toBe(false);
  });

  it("falls back to the default when the stored value is undefined", () => {
    expect(resolvePreference("googlePay", undefined)).toBe(true);
    expect(resolvePreference("applePay", undefined)).toBe(false);
  });

  it("honors an explicit false even for a method whose default is on", () => {
    // null vs false must be distinguished: false is an explicit opt-out, not "use default".
    expect(resolvePreference("paypalButtons", false)).toBe(false);
    expect(resolvePreference("card", false)).toBe(false);
    expect(resolvePreference("googlePay", false)).toBe(false);
  });

  it("honors an explicit true even for Apple Pay whose default is off", () => {
    expect(resolvePreference("applePay", true)).toBe(true);
  });
});

describe("resolveEffectivePaymentMethods", () => {
  it("fresh merchant, all allowed, no preferences -> everything on except Apple Pay", () => {
    expect(resolveEffectivePaymentMethods(ALL_ALLOWED, NO_PREFERENCES)).toStrictEqual({
      paypalButtons: true,
      advancedCardProcessing: true,
      applePay: false,
      googlePay: true,
    });
  });

  it("never enables a method PayPal disallows, regardless of preference", () => {
    const allPreferred: StoredPaymentMethodPreferences = {
      prefPaypalButtons: true,
      prefCard: true,
      prefApplePay: true,
      prefGooglePay: true,
    };

    expect(resolveEffectivePaymentMethods(NONE_ALLOWED, allPreferred)).toStrictEqual({
      paypalButtons: false,
      advancedCardProcessing: false,
      applePay: false,
      googlePay: false,
    });
  });

  it("readiness flips to false while preference stays true -> effective false", () => {
    const cardPreferredOn: StoredPaymentMethodPreferences = {
      ...NO_PREFERENCES,
      prefCard: true,
    };
    const cardNotAllowed: PaymentMethodCapability = {
      ...ALL_ALLOWED,
      advancedCardProcessing: false,
    };

    expect(
      resolveEffectivePaymentMethods(cardNotAllowed, cardPreferredOn).advancedCardProcessing
    ).toBe(false);
  });

  it("Apple Pay becomes enabled only when allowed AND explicitly preferred on", () => {
    expect(
      resolveEffectivePaymentMethods(ALL_ALLOWED, { ...NO_PREFERENCES, prefApplePay: true }).applePay
    ).toBe(true);

    // Allowed but no explicit opt-in -> stays off by default.
    expect(resolveEffectivePaymentMethods(ALL_ALLOWED, NO_PREFERENCES).applePay).toBe(false);

    // Explicitly opted in but PayPal does not allow it -> still off.
    expect(
      resolveEffectivePaymentMethods(
        { ...ALL_ALLOWED, applePay: false },
        { ...NO_PREFERENCES, prefApplePay: true }
      ).applePay
    ).toBe(false);
  });

  it("explicit opt-out disables an allowed, default-on method", () => {
    const buttonsOff: StoredPaymentMethodPreferences = {
      ...NO_PREFERENCES,
      prefPaypalButtons: false,
    };

    expect(resolveEffectivePaymentMethods(ALL_ALLOWED, buttonsOff).paypalButtons).toBe(false);
    // Other default-on methods remain unaffected.
    expect(resolveEffectivePaymentMethods(ALL_ALLOWED, buttonsOff).googlePay).toBe(true);
  });
});

describe("findDisallowedEnabledMethods", () => {
  const ALL_ALLOWED_BY_KEY: PaymentMethodCapabilityByKey = {
    paypalButtons: true,
    card: true,
    applePay: true,
    googlePay: true,
  };

  it("returns empty when enabling only allowed methods", () => {
    expect(
      findDisallowedEnabledMethods(
        { paypalButtons: true, card: true, applePay: true, googlePay: true },
        ALL_ALLOWED_BY_KEY
      )
    ).toStrictEqual([]);
  });

  it("flags a method enabled while PayPal disallows it", () => {
    expect(
      findDisallowedEnabledMethods(
        { applePay: true },
        { ...ALL_ALLOWED_BY_KEY, applePay: false }
      )
    ).toStrictEqual(["applePay"]);
  });

  it("flags every disallowed method that is being enabled", () => {
    const result = findDisallowedEnabledMethods(
      { paypalButtons: true, card: true, applePay: true, googlePay: true },
      { paypalButtons: false, card: false, applePay: true, googlePay: true }
    );

    expect(result.sort()).toStrictEqual(["card", "paypalButtons"].sort());
  });

  it("does not flag DISABLING a method PayPal disallows (only enabling is guarded)", () => {
    // Turning something off must always be permitted, even when capability is false.
    expect(
      findDisallowedEnabledMethods(
        { applePay: false, card: false },
        { paypalButtons: false, card: false, applePay: false, googlePay: false }
      )
    ).toStrictEqual([]);
  });

  it("ignores methods left unchanged (undefined)", () => {
    expect(
      findDisallowedEnabledMethods({ googlePay: true }, { ...ALL_ALLOWED_BY_KEY, applePay: false })
    ).toStrictEqual([]);
  });
});
