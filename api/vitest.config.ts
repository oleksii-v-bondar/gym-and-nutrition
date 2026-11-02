import { defineConfig } from 'vitest/config';
// fileParallelism disabled: integration test files share one Postgres DB and each
// setupTestDb() drops/recreates the whole public schema, which races across
// concurrently-run files (e.g. duplicate pg_extension_name_index on pgcrypto).
export default defineConfig({ test: { environment: 'node', globals: true, fileParallelism: false } });
