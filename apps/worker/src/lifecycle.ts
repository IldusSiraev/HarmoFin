export interface WorkerShutdownDependencies {
  healthServer: { stop(): Promise<void> };
  runtime: { stop(signal: NodeJS.Signals): Promise<void> };
  database: { $disconnect(): Promise<void> };
}

export async function shutdownWorker(
  signal: NodeJS.Signals,
  { healthServer, runtime, database }: WorkerShutdownDependencies,
): Promise<void> {
  await healthServer.stop();
  await runtime.stop(signal);
  await database.$disconnect();
}
