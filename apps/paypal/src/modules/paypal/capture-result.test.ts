import { describe, expect, it } from "vitest";

import { formatDeclineMessage, interpretCaptureResponse } from "./capture-result";
import { PayPalOrder } from "./types";

/*
 * The bug these tests exist to prevent:
 * PayPal returns order.status = COMPLETED while the inner capture status
 * is DECLINED. Reading only order.status produces silent false-positives
 * where Saleor marks orders paid for which no money moved.
 */

const order = (overrides: Partial<PayPalOrder> = {}): PayPalOrder =>
  ({
    id: "ORDER123" as PayPalOrder["id"],
    status: "COMPLETED",
    purchase_units: [
      {
        amount: { currency_code: "USD", value: "25.00" } as never,
        payments: {
          captures: [
            {
              id: "CAP123",
              status: "COMPLETED",
              amount: { currency_code: "USD", value: "25.00" } as never,
            },
          ],
        },
      },
    ],
    ...overrides,
  }) as PayPalOrder;

describe("interpretCaptureResponse", () => {
  it("returns succeeded when capture.status is COMPLETED", () => {
    const result = interpretCaptureResponse(order());

    expect(result).toStrictEqual({ kind: "succeeded", captureId: "CAP123" });
  });

  /*
   * THE bug scenario. Without this test the regression slips back in.
   * Order COMPLETED + capture DECLINED means PayPal's risk engine or the issuer
   * declined the charge but the order workflow terminated. Money did NOT move.
   */
  it("returns declined when order.status is COMPLETED but capture.status is DECLINED", () => {
    const result = interpretCaptureResponse(
      order({
        status: "COMPLETED",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "25.00" } as never,
            payments: {
              captures: [
                {
                  id: "CAP_DECLINED",
                  status: "DECLINED",
                  amount: { currency_code: "USD", value: "25.00" } as never,
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result.kind).toBe("declined");
    if (result.kind === "declined") {
      expect(result.captureId).toBe("CAP_DECLINED");
      expect(result.captureStatus).toBe("DECLINED");
    }
  });

  it("returns declined for capture.status FAILED", () => {
    const result = interpretCaptureResponse(
      order({
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "25.00" } as never,
            payments: {
              captures: [
                {
                  id: "CAP_FAILED",
                  status: "FAILED",
                  amount: { currency_code: "USD", value: "25.00" } as never,
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result.kind).toBe("declined");
  });

  it("returns declined defensively for unknown capture.status", () => {
    /*
     * If PayPal introduces a new failure-shaped status, default to declined
     * rather than silently treating it as success.
     */
    const result = interpretCaptureResponse(
      order({
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "25.00" } as never,
            payments: {
              captures: [
                {
                  id: "CAP_FUTURE",
                  /*
                   * Cast through unknown so the test simulates a real PayPal
                   * response shape that hasn't been added to the type union yet.
                   */
                  status: "QUARANTINED_FOR_REVIEW" as unknown as "COMPLETED",
                  amount: { currency_code: "USD", value: "25.00" } as never,
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result.kind).toBe("declined");
    if (result.kind === "declined") {
      expect(result.captureStatus).toBe("QUARANTINED_FOR_REVIEW");
    }
  });

  it("returns pending when capture.status is PENDING", () => {
    const result = interpretCaptureResponse(
      order({
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "25.00" } as never,
            payments: {
              captures: [
                {
                  id: "CAP_PENDING",
                  status: "PENDING",
                  amount: { currency_code: "USD", value: "25.00" } as never,
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result).toStrictEqual({ kind: "pending", captureId: "CAP_PENDING" });
  });

  it("returns missing when purchase_units is empty", () => {
    const result = interpretCaptureResponse(
      order({ purchase_units: [], status: "APPROVED" }),
    );

    expect(result).toStrictEqual({ kind: "missing", orderStatus: "APPROVED" });
  });

  it("returns missing when payments object is absent", () => {
    const result = interpretCaptureResponse(
      order({
        status: "APPROVED",
        purchase_units: [
          { amount: { currency_code: "USD", value: "25.00" } as never },
        ],
      }),
    );

    expect(result).toStrictEqual({ kind: "missing", orderStatus: "APPROVED" });
  });

  it("returns missing when captures array is empty", () => {
    const result = interpretCaptureResponse(
      order({
        status: "APPROVED",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "25.00" } as never,
            payments: { captures: [] },
          },
        ],
      }),
    );

    expect(result).toStrictEqual({ kind: "missing", orderStatus: "APPROVED" });
  });

  it("returns missing when capture has no id (malformed response)", () => {
    const result = interpretCaptureResponse(
      order({
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "25.00" } as never,
            payments: {
              captures: [
                {
                  id: "" as unknown as string,
                  status: "COMPLETED",
                  amount: { currency_code: "USD", value: "25.00" } as never,
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result.kind).toBe("missing");
  });

  it("uses the first capture when multiple are present", () => {
    /*
     * PayPal docs allow multiple captures per purchase_unit (split payments).
     * The first one represents this transaction. Document the choice.
     */
    const result = interpretCaptureResponse(
      order({
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "25.00" } as never,
            payments: {
              captures: [
                {
                  id: "CAP_FIRST",
                  status: "COMPLETED",
                  amount: { currency_code: "USD", value: "12.50" } as never,
                },
                {
                  id: "CAP_SECOND",
                  status: "DECLINED",
                  amount: { currency_code: "USD", value: "12.50" } as never,
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result).toStrictEqual({ kind: "succeeded", captureId: "CAP_FIRST" });
  });

  it("extracts processor_response fields on decline", () => {
    const result = interpretCaptureResponse(
      order({
        purchase_units: [
          {
            amount: { currency_code: "USD", value: "25.00" } as never,
            payments: {
              captures: [
                {
                  id: "CAP_DECLINED",
                  status: "DECLINED",
                  amount: { currency_code: "USD", value: "25.00" } as never,
                  /*
                   * The capture type now includes processor_response, but it's
                   * still optional at runtime. Test the populated-on-decline shape.
                   */
                  processor_response: {
                    response_code: "0500",
                    avs_code: "N",
                    cvv_code: "M",
                  },
                } as never,
              ],
            },
          },
        ],
      }),
    );

    expect(result.kind).toBe("declined");
    if (result.kind === "declined") {
      expect(result.reasonCode).toBe("0500");
      expect(result.avsCode).toBe("N");
      expect(result.cvvCode).toBe("M");
    }
  });
});

describe("formatDeclineMessage", () => {
  it("includes processor codes when present", () => {
    const message = formatDeclineMessage({
      kind: "declined",
      captureId: "CAP1",
      captureStatus: "DECLINED",
      reasonCode: "0500",
      avsCode: "N",
      cvvCode: "M",
    });

    expect(message).toBe("Capture declined processor_response_code=0500 avs=N cvv=M");
  });

  it("omits absent processor codes", () => {
    const message = formatDeclineMessage({
      kind: "declined",
      captureId: "CAP1",
      captureStatus: "DECLINED",
    });

    expect(message).toBe("Capture declined");
  });

  it("includes unknown status verbatim", () => {
    const message = formatDeclineMessage({
      kind: "declined",
      captureId: "CAP1",
      captureStatus: "QUARANTINED_FOR_REVIEW",
    });

    expect(message).toBe("Capture quarantined_for_review");
  });
});
