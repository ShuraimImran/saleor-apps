/* eslint-disable no-console */
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

import { env } from "@/lib/env";

/**
 * IWT Debug Logger
 *
 * Logs full PayPal HTTP request/response for IWT (Integration Wellness Test) submission.
 * Supports both console output and optional file logging.
 *
 * Enable via environment variables:
 * - PAYPAL_DEBUG_LOGGING=true - Enable debug logging
 * - PAYPAL_DEBUG_LOG_FILE=/path/to/file.log - Optional file path for logs
 *
 * WARNING: Only enable for IWT capture. Disable in production (PCI compliance).
 */

interface IwtRequestLog {
  timestamp: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown | null;
}

interface IwtResponseLog {
  timestamp: string;
  status: number;
  statusText: string;
  headers: Record<string, string | null>;
  body: unknown;
  response_time_ms: number;
}

/**
 * Check if IWT debug logging is enabled
 */
export function isIwtDebugEnabled(): boolean {
  return env.PAYPAL_DEBUG_LOGGING === true;
}

/**
 * Get the IWT debug log file path (if configured)
 */
function getLogFilePath(): string | undefined {
  return env.PAYPAL_DEBUG_LOG_FILE;
}

/**
 * Ensure the log file directory exists
 */
function ensureLogDirectory(filePath: string): void {
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write a log entry to file (if configured)
 */
function writeToFile(content: string): void {
  const filePath = getLogFilePath();

  if (!filePath) return;

  try {
    ensureLogDirectory(filePath);
    appendFileSync(filePath, content + "\n", "utf8");
  } catch (error) {
    // Don't throw on file write errors - just log to console
    console.error("[IWT Debug] Failed to write to log file:", error);
  }
}

/**
 * Format log entry for console/file output
 */
function formatLogEntry(type: "REQUEST" | "RESPONSE" | "ERROR_RESPONSE", data: IwtRequestLog | IwtResponseLog): string {
  const separator = "=".repeat(50);
  const lines: string[] = [];

  lines.push("");
  lines.push(separator);
  lines.push(`IWT ${type} - ${data.timestamp}`);
  lines.push(separator);

  if (type === "REQUEST") {
    const req = data as IwtRequestLog;

    lines.push(`${req.method} ${req.url}`);
    lines.push("");
    lines.push("Headers:");
    lines.push(JSON.stringify(req.headers, null, 2));
    if (req.body) {
      lines.push("");
      lines.push("Body:");
      lines.push(JSON.stringify(req.body, null, 2));
    }
  } else {
    const res = data as IwtResponseLog;

    lines.push(`Status: ${res.status} ${res.statusText}`);
    lines.push(`Response Time: ${res.response_time_ms}ms`);
    lines.push("");
    lines.push("Headers:");
    lines.push(JSON.stringify(res.headers, null, 2));
    lines.push("");
    lines.push("Body:");
    lines.push(JSON.stringify(res.body, null, 2));
  }

  lines.push(separator);
  lines.push("");

  return lines.join("\n");
}

/**
 * Log a PayPal API request for IWT submission
 */
export function logIwtRequest(data: IwtRequestLog): void {
  if (!isIwtDebugEnabled()) return;

  const formatted = formatLogEntry("REQUEST", data);

  // Console output
  console.log(formatted);

  // File output
  writeToFile(formatted);
}

/**
 * Log a PayPal API success response for IWT submission
 */
export function logIwtResponse(data: IwtResponseLog): void {
  if (!isIwtDebugEnabled()) return;

  const formatted = formatLogEntry("RESPONSE", data);

  // Console output
  console.log(formatted);

  // File output
  writeToFile(formatted);
}

/**
 * Log a PayPal API error response for IWT submission
 */
export function logIwtErrorResponse(data: IwtResponseLog): void {
  if (!isIwtDebugEnabled()) return;

  const formatted = formatLogEntry("ERROR_RESPONSE", data);

  // Console output
  console.log(formatted);

  // File output
  writeToFile(formatted);
}

/**
 * Log a custom message for IWT debugging
 */
export function logIwtMessage(message: string, data?: unknown): void {
  if (!isIwtDebugEnabled()) return;

  const timestamp = new Date().toISOString();
  const separator = "-".repeat(50);
  const lines: string[] = [];

  lines.push("");
  lines.push(separator);
  lines.push(`IWT DEBUG - ${timestamp}`);
  lines.push(message);
  if (data) {
    lines.push(JSON.stringify(data, null, 2));
  }
  lines.push(separator);
  lines.push("");

  const formatted = lines.join("\n");

  // Console output
  console.log(formatted);

  // File output
  writeToFile(formatted);
}

/**
 * Get the log file path for reference (useful for telling users where logs are)
 */
export function getIwtLogFilePath(): string | undefined {
  return getLogFilePath();
}
