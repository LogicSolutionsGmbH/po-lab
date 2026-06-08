/** Track A harness config — sourced from env (.env). All secrets/ids are PLACEHOLDERS. */

import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

export interface HarnessConfig {
  db: {
    server: string;
    database: string;
    user: string;
    password: string;
    port: number;
    encrypt: boolean;
    trustServerCertificate: boolean;
  };
  /** Directorio tenant id = cd_identityTenant = cd_identityDatosRFC (processing office). */
  directoryTenantId: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('__PLACEHOLDER')) {
    throw new Error(
      `Missing/placeholder env var ${name}. Copy .env.example to .env and fill in the dev tenant DB + cd_identityDatosRFC.`,
    );
  }
  return value;
}

export function loadHarnessConfig(): HarnessConfig {
  return {
    db: {
      server: required('SDK_DB_SERVER'),
      database: required('SDK_DB_NAME'),
      user: required('SDK_DB_USER'),
      password: required('SDK_DB_PASSWORD'),
      port: Number(process.env.SDK_DB_PORT ?? '1433'),
      encrypt: (process.env.SDK_DB_ENCRYPT ?? 'false') === 'true',
      trustServerCertificate: (process.env.SDK_DB_TRUST_SERVER_CERT ?? 'true') === 'true',
    },
    directoryTenantId: Number(required('SDK_DIRECTORY_TENANT_ID')),
  };
}
