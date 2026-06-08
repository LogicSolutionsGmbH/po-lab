/**
 * Track A runner — proves entity-resolution in-process against the worker's kind of live Kysely
 * pool, with zero new auth (decision worker_scope=A: resolve-and-validate only; no Participantes
 * write, no provision gate). Runs TC-1…TC-12, asserts resolution_status, prints §9 observability.
 *
 * Usage: cp .env.example .env  (fill placeholders)  &&  pnpm harness
 */

import { performance } from 'perf_hooks';

import { resolveEntity } from '../resolve';
import { consoleLogger } from '../core/logging';
import { loadHarnessConfig } from './config';
import { createKyselyConnection, testConnection } from './connection';
import { SCENARIOS } from './scenarios';

function hasPlaceholders(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('__PLACEHOLDER__');
  if (Array.isArray(value)) return value.some(hasPlaceholders);
  if (value && typeof value === 'object') return Object.values(value).some(hasPlaceholders);
  return false;
}

async function main(): Promise<void> {
  const config = loadHarnessConfig();
  const db = createKyselyConnection(config.db);

  const ok = await testConnection(db);
  if (!ok) {
    console.error('Could not connect to the dev tenant DB. Check .env values.');
    await db.destroy();
    process.exitCode = 1;
    return;
  }

  console.info(`Connected. directoryTenantId=${config.directoryTenantId}\n`);

  const latencies: number[] = [];
  let pass = 0;
  let fail = 0;
  let skipped = 0;

  for (const scenario of SCENARIOS) {
    if (scenario.skip) {
      console.info(`SKIP  ${scenario.id}  ${scenario.description} — ${scenario.note ?? ''}`);
      skipped++;
      continue;
    }

    if (hasPlaceholders(scenario.signals)) {
      console.warn(
        `TODO  ${scenario.id}  ${scenario.description} — fill placeholder signals${scenario.needsSeed ? ' (also needs seeded rows)' : ''}`,
      );
      skipped++;
      continue;
    }

    const t0 = performance.now();
    try {
      const result = await resolveEntity(
        db,
        {
          tenantId: config.directoryTenantId,
          signals: scenario.signals,
          confirm_match: scenario.confirm_match ?? null,
        },
        { logger: consoleLogger },
      );
      const ms = performance.now() - t0;
      latencies.push(ms);

      const matched = result.resolution_status === scenario.expected;
      if (matched) pass++;
      else fail++;

      console.info(
        `${matched ? 'PASS' : 'FAIL'}  ${scenario.id}  expected=${scenario.expected} got=${result.resolution_status} ` +
          `entity=${result.entity_id ?? '-'} address=${result.entity_address_id ?? '-'} ` +
          `alias=${result.alias_hit} ${ms.toFixed(0)}ms`,
      );
    } catch (error) {
      fail++;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`ERROR ${scenario.id}  ${scenario.description} — ${msg}`);
    }
  }

  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    console.info(
      `\nLatency: p50=${p(0.5).toFixed(0)}ms p95=${p(0.95).toFixed(0)}ms (n=${latencies.length})`,
    );
  }
  console.info(`\nResult: ${pass} passed, ${fail} failed, ${skipped} skipped/TODO.`);

  await db.destroy();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
