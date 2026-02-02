/**
 * Generate PayPal-Auth-Assertion header value
 *
 * Usage:
 *   node generate-auth-assertion.js
 *
 * Then use the output as the PayPal-Auth-Assertion header in Postman.
 */

// ============================================
// FILL IN YOUR VALUES
// ============================================
const PARTNER_CLIENT_ID = "Acj39qVkeLUlllGkzKVmEv_1t0YcqkEUbGksamtoIOfEX8hiMcflYdjI5PLtz8q4UT6zO7nCb_dLYMPk";
const MERCHANT_PAYPAL_ID = "N33QHXGJJKGAN";

// ============================================
// GENERATE
// ============================================
const part1 = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64");
const part2 = Buffer.from(
  JSON.stringify({
    iss: PARTNER_CLIENT_ID,
    payer_id: MERCHANT_PAYPAL_ID,
  })
).toString("base64");

const authAssertion = `${part1}.${part2}.`;

console.log("PayPal-Auth-Assertion:");
console.log(authAssertion);
