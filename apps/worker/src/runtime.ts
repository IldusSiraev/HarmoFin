import { MessageChannel } from 'node:worker_threads';

export type WorkerState = 'created' | 'running' | 'stopping' | 'stopped';

export interface WorkerLogger {
  started(): void;
  stopped(signal: NodeJS.Signals): void;
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
    private readonly createKeepAlive: KeepAliveFactory = createMessageChannelKeepAlive,
  ) {}

  get state(): WorkerState {
    return this.currentState;
  }

  start(): void {
    if (this.currentState === 'stopped') {
      throw new Error('Worker has already stopped');
    }

    if (this.currentState !== 'created') {
      return;
    }

    this.keepAlive = this.createKeepAlive();
    this.currentState = 'running';
    this.logger.started();
  }

  async stop(signal: NodeJS.Signals): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping') {
      return;
    }

    this.currentState = 'stopping';
    this.keepAlive?.close();
    this.keepAlive = undefined;
    this.currentState = 'stopped';
    this.logger.stopped(signal);
  }
}

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
