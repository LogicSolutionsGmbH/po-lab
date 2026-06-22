/**
 * list-requests — discover handshake requests (works for both roles).
 *
 * - As the TAKER (assignee): see requests addressed to you (your inbox) and
 *   grab the serviceId you need to accept/reject.
 * - As the MAKER (assigner): see the handshakes you've sent and their status.
 *
 * The direction selects which API key is used by default:
 *   incoming → taker key,  outgoing → maker key. Override with --role.
 *
 * Usage:
 *   npx tsx list-requests.ts --direction incoming|outgoing [--role maker|taker]
 *
 * Example:
 *   npx tsx list-requests.ts --direction incoming
 */
import { run, parseArgs, flagString, keyForRole, api, heading, type Role } from './lib';

run(async (config) => {
  const { flags } = parseArgs(process.argv.slice(2));
  const direction = flagString(flags, 'direction') ?? 'incoming';
  if (direction !== 'incoming' && direction !== 'outgoing' && direction !== 'all') {
    throw new Error('--direction must be one of: incoming, outgoing, all');
  }

  const defaultRole: Role = direction === 'outgoing' ? 'maker' : 'taker';
  const role = (flagString(flags, 'role') as Role | undefined) ?? defaultRole;
  const apiKey = keyForRole(config, role, flags);

  heading(`Service requests (${direction}, as ${role})`);
  const data = await api<any>(config, {
    method: 'GET',
    path: '/services/requests',
    apiKey,
    query: { direction },
  });

  const items: any[] = Array.isArray(data)
    ? data
    : (data?.requests ?? data?.instances ?? []);

  if (items.length === 0) {
    console.log('  (none)');
    return;
  }

  for (const it of items) {
    const serviceId = it.serviceId ?? it.service?.id ?? '—';
    const strategy = it.strategyKey ?? it.strategy?.strategyKey ?? 'HANDSHAKE';
    const step = it.currentStepKey ?? it.stepKey ?? it.status ?? '—';
    console.log(`  • ${serviceId}   ${strategy} / ${step}`);
  }
  console.log(`\n  ${items.length} request(s).`);
});
