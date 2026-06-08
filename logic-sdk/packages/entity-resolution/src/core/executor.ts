import type { Kysely } from 'kysely';

/**
 * The injected query executor (the SDK's decoupling boundary).
 *
 * Decision (grill 2026-06-07, executor_boundary=A): the prototype accepts a Kysely instance.
 * The ported kernel leans on Kysely's `sql` tagged template across all DB methods, and both real
 * consumers (email-worker + journeys) already speak Kysely. A raw `query(sql, params)` port is a
 * deliberately deferred build-phase concern.
 *
 * Typed as `Kysely<any>` so the SDK does not drag any host's generated `tenantdb` schema in — the
 * kernel issues raw `sql<T>` queries that do not need the typed schema. A host passes its own live
 * connection (e.g. the worker's `getTenantInstance(tenantConfig)` pool) directly; the SDK inherits
 * whatever auth/connection the running program already holds. No token dance, no network hop.
 */
export type QueryExecutor = Kysely<any>;

/**
 * Wrap a host Kysely connection as an SDK executor. Identity today (boundary marker); the seam a
 * future raw-port / non-Kysely adapter would slot behind.
 */
export function kyselyExecutor(db: Kysely<any>): QueryExecutor {
  return db;
}
