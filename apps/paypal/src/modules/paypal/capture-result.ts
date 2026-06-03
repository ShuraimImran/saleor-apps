import { PayPalOrder } from "./types";

/*
 * PayPal Orders v2 has TWO status fields whose semantics differ:
 *
 *   order.status                                                — workflow lifecycle (COMPLETED = terminated)
 *   order.purchase_units[0].payments.captures[0].status         — actual money-movement outcome
 *
 * A capture can be DECLINED while the parent order is COMPLETED.
 * Reading only order.status reports declined payments as successful.
 *
 * Always interpret a capture response through this helper.
 */

export type CaptureOutcome =
  | { kind: "succeeded"; captureId: string }
  | { kind: "pending"; captureId: string }
  | {
      kind: "declined";
      captureId: string;
      captureStatus: string;
      reasonCode?: string;
      avsCode?: string;
      cvvCode?: string;
    }
  | { kind: "missing"; orderStatus: PayPalOrder["status"] };

interface ProcessorResponse {
  response_code?: string;
  avs_code?: string;
  cvv_code?: string;
}

interface CaptureWithProcessor {
  id?: string;
  status?: string;
  processor_response?: ProcessorResponse;
}

export const interpretCaptureResponse = (order: PayPalOrder): CaptureOutcome => {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0] as
    | CaptureWithProcessor
    | undefined;

  if (!capture || !capture.id) {
    return { kind: "missing", orderStatus: order.status };
  }

  const status = capture.status;

  if (status === "COMPLETED") {
    return { kind: "succeeded", captureId: capture.id };
  }

  if (status === "PENDING") {
    return { kind: "pending", captureId: capture.id };
  }

  /*
   * Anything else — DECLINED, FAILED, PARTIALLY_REFUNDED used as a payment outcome,
   * or any unknown future status — is treated as a non-success outcome.
   * Defaulting to declined for unknowns prevents silent false-positives if PayPal
   * introduces a new failure-shaped status.
   */
  return {
    kind: "declined",
    captureId: capture.id,
    captureStatus: status ?? "UNKNOWN",
    reasonCode: capture.processor_response?.response_code,
    avsCode: capture.processor_response?.avs_code,
    cvvCode: capture.processor_response?.cvv_code,
  };
};

export const formatDeclineMessage = (
  outcome: Extract<CaptureOutcome, { kind: "declined" }>,
): string => {
  const parts: string[] = [`Capture ${outcome.captureStatus.toLowerCase()}`];

  if (outcome.reasonCode) {
    parts.push(`processor_response_code=${outcome.reasonCode}`);
  }
  if (outcome.avsCode) {
    parts.push(`avs=${outcome.avsCode}`);
  }
  if (outcome.cvvCode) {
    parts.push(`cvv=${outcome.cvvCode}`);
  }

  return parts.join(" ");
};
