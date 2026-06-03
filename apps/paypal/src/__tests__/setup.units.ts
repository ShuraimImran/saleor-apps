import { vi } from "vitest";

process.env.TZ = "UTC";

vi.stubEnv("SECRET_KEY", "test_secret_key_must_be_at_least_32_chars_long_abcd");
vi.stubEnv("ALLOWED_DOMAIN_PATTERN", ".*");
vi.stubEnv("APL", "file");

export {};
