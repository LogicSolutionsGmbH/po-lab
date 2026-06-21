/**
 * show-service — inspect the strategy state of a service (both roles).
 *
 * Lists all strategy instances on a service (active and historical) with their
 * current step, so you can verify a handshake landed where you expect
 * (INITIATED → ACCEPTED / REJECTED).
 *
 * Usage:
 *   npx tsx show-service.ts <serviceId> [--role maker|taker]
 *
 * Example:
 *   npx tsx show-service.ts 550e8400-... --role maker
 */
import { run, parseArgs, flagString, keyForRole, api, heading, kv, type Role } from './lib';

run(async (config) => {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const serviceId = positional[0];
  const role = (flagString(flags, 'role') as Role | undefined) ?? 'maker';

  if (!serviceId) {
    throw new Error('Usage: npx tsx show-service.ts <serviceId> [--role maker|taker]');
  }

  const apiKey = keyForRole(config, role);

  heading(`Strategy instances for ${serviceId}`);
  const data = await api<any>(config, {
    method: 'GET',
    path: `/services/${serviceId}/strategies`,
    apiKey,
  });

  const instances: any[] = Array.isArray(data) ? data : (data?.instances ?? []);
  if (instances.length === 0) {
    console.log('  (no strategy instances)');
    return;
  }

  for (const inst of instances) {
    const strategy = inst.strategyKey ?? inst.strategy?.strategyKey ?? 'HANDSHAKE';
    const step = inst.currentStepKey ?? inst.currentStep?.key ?? '—';
    console.log(`\n  • ${strategy} / ${step}`);
    kv('instanceId', inst.id ?? '—');
    if (inst.startedAt) kv('startedAt', inst.startedAt);
    if (inst.completedAt) kv('completedAt', inst.completedAt);
  }
});
