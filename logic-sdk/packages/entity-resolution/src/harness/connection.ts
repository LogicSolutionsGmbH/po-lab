/**
 * MSSQL connection for the harness — mirrors email-worker `helper/mssql.connection.ts`
 * (knex `mssql` client + kysely-knex `MSSQLColdDialect`). This is the same kind of live Kysely
 * pool the worker would pass into the SDK in-process, proving the "inherit the host connection,
 * no token" thesis (Track A).
 */

import Knex from 'knex';
import { Kysely, sql } from 'kysely';
import { KyselyKnexDialect, MSSQLColdDialect } from 'kysely-knex';

import type { HarnessConfig } from './config';

export function createKyselyConnection(config: HarnessConfig['db']): Kysely<any> {
  const knexInstance = Knex({
    client: 'mssql',
    connection: {
      server: config.server,
      database: config.database,
      user: config.user,
      password: config.password,
      port: config.port,
      options: {
        encrypt: config.encrypt,
        trustServerCertificate: config.trustServerCertificate,
      },
    },
    pool: { min: 0, max: 10, idleTimeoutMillis: 30000 },
  });

  return new Kysely<any>({
    dialect: new KyselyKnexDialect({
      knex: knexInstance,
      kyselySubDialect: new MSSQLColdDialect(),
    }),
  });
}

export async function testConnection(db: Kysely<any>): Promise<boolean> {
  try {
    await sql`SELECT 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}
