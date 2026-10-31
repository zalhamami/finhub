import { PgBoss } from 'pg-boss';

export { PgBoss };

/** pg-boss keeps its tables in its own schema, away from the app's `public` tables and Drizzle migrations. */
export const PGBOSS_SCHEMA = 'pgboss';

/** Job name -> payload type. Add new jobs here; the registry below is then forced to handle them. */
export interface JobMap {
  'system.ping': { sentAt?: string };
  // TODO(M3): 'snapshot.nightly' - nightly net-worth snapshot, scheduled with boss.schedule().
}
export type JobName = keyof JobMap;

export type JobHandler<N extends JobName> = (data: JobMap[N]) => Promise<void> | void;
export type JobRegistry = { [N in JobName]: JobHandler<N> };

/** Registry used by the server: only the wiring check for now. */
export const defaultRegistry: JobRegistry = {
  'system.ping': (data) => {
    console.log(`finhub jobs: system.ping handled${data.sentAt ? ` (sent ${data.sentAt})` : ''}`);
  },
};

/** Create (not yet started) pg-boss instance on `databaseUrl`, using the dedicated `pgboss` schema. */
export function createBoss(databaseUrl: string): PgBoss {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: PGBOSS_SCHEMA, max: 4 });
  boss.on('error', (err) => console.error('finhub jobs: pg-boss error', err));
  return boss;
}

/**
 * Start pg-boss (creates/migrates its schema), ensure every registered queue exists and attach a worker per
 * job. Returns the started boss; stop it with `stopBoss`.
 */
export async function startWorker(
  boss: PgBoss,
  registry: JobRegistry = defaultRegistry,
): Promise<PgBoss> {
  await boss.start();
  for (const name of Object.keys(registry) as JobName[]) {
    await boss.createQueue(name);
    const handler = registry[name] as JobHandler<JobName>;
    await boss.work<JobMap[JobName]>(name, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }
  return boss;
}

/** Graceful stop: let active jobs finish (up to 10s), then close pg-boss' connection pool. */
export async function stopBoss(boss: PgBoss): Promise<void> {
  await boss.stop({ graceful: true, timeout: 10_000 });
}

/** Typed enqueue helper. */
export function sendJob<N extends JobName>(boss: PgBoss, name: N, data: JobMap[N]) {
  return boss.send(name, data);
}
