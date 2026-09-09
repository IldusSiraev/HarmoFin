import { MessageChannel } from 'node:worker_threads';

export type WorkerState = 'created' | 'running' | 'stopping' | 'stopped';

export interface WorkerLogger {
  started(): void;
  stopped(signal: NodeJS.Signals): void;
}

export interface WorkerJobRunner {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface KeepAliveHandle {
  close(): void;
}

export type KeepAliveFactory = () => KeepAliveHandle;

export class WorkerRuntime {
  private currentState: WorkerState = 'created';
  private keepAlive: KeepAliveHandle | undefined;

  constructor(
    private readonly logger: WorkerLogger,
    private readonly runner: WorkerJobRunner = noOpRunner,
    private readonly createKeepAlive: KeepAliveFactory = createMessageChannelKeepAlive,
  ) {}

  get state(): WorkerState {
    return this.currentState;
  }

  get isReady(): boolean {
    return this.currentState === 'running';
  }

  async start(): Promise<void> {
    if (this.currentState === 'stopped') {
      throw new Error('Worker has already stopped');
    }

    if (this.currentState !== 'created') {
      return;
    }

    await this.runner.start();
    this.keepAlive = this.createKeepAlive();
    this.currentState = 'running';
    this.logger.started();
  }

  async stop(signal: NodeJS.Signals): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping') {
      return;
    }

    this.currentState = 'stopping';
    await this.runner.stop();
    this.keepAlive?.close();
    this.keepAlive = undefined;
    this.currentState = 'stopped';
    this.logger.stopped(signal);
  }
}

const noOpRunner: WorkerJobRunner = {
  async start(): Promise<void> {},
  async stop(): Promise<void> {},
};

function createMessageChannelKeepAlive(): KeepAliveHandle {
  const { port1, port2 } = new MessageChannel();
  port1.on('message', () => undefined);

  return {
    close(): void {
      port1.close();
      port2.close();
    },
  };
}
