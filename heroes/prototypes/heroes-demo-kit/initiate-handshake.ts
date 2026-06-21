/**
 * initiate-handshake — open a HANDSHAKE on an EXISTING service (assigner / maker).
 *
 * Use this when the journey and service already exist (e.g. created earlier or
 * via create-shipment) and you just want to (re-)initiate a handshake toward a
 * target tenant. Optionally attaches a payload file.
 *
 * Usage:
 *   npx tsx initiate-handshake.ts <serviceId> --target <tenantKey> \
 *       [<payload-folder>] [--name <eventName>] [--lo-code <UNLOCODE>]
 *
 * Example:
 *   npx tsx initiate-handshake.ts 550e8400-... --target schryver ./payloads/shipment-booking
 */
import {
  run,
  parseArgs,
  flagString,
  keyForRole,
  readPayloadFolder,
  createEventWithAttachment,
  heading,
  kv,
} from './lib';

run(async (config) => {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const serviceId = positional[0];
  const folder = positional[1];
  const target = flagString(flags, 'target');
  const name = flagString(flags, 'name') ?? 'Service Request';
  const loCode = flagString(flags, 'lo-code');

  if (!serviceId || !target) {
    throw new Error(
      'Usage: npx tsx initiate-handshake.ts <serviceId> --target <tenantKey> ' +
        '[<payload-folder>] [--name <eventName>] [--lo-code <UNLOCODE>]',
    );
  }

  const apiKey = keyForRole(config, 'maker');
  const payload = folder ? readPayloadFolder(folder) : undefined;

  heading(`Initiating handshake → ${target}`);
  const { event, attachmentMode } = await createEventWithAttachment(config, {
    serviceId,
    apiKey,
    event: {
      name,
      loCode,
      strategy: { strategyKey: 'HANDSHAKE', stepKey: 'INITIATED', targetTenantKey: target },
    },
    payload,
  });
  kv('serviceId', serviceId);
  kv('eventId', event.id);
  if (payload) kv('attachment', `${payload.filename} (${attachmentMode})`);
});
