import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

export interface DatabasePool {
  query(statement: string): Promise<unknown>;
  end(): Promise<void>;
}

export function createDatabasePool(connectionString: string): DatabasePool {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 2_000,
  });

  return {
    async query(statement: string): Promise<void> {
      await pool.query(statement);
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}

@Injectable()
export class DatabaseHealthService implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: DatabasePool) {}

  async check(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}
