export type WorkerState = 'created' | 'running' | 'stopping' | 'stopped';

export interface WorkerLogger {
  started(): void;
  stopped(signal: NodeJS.Signals): void;
}

export class WorkerRuntime {
  private currentState: WorkerState = 'created';

  constructor(private readonly logger: WorkerLogger) {}

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

    this.currentState = 'running';
    this.logger.started();
  }

  async stop(signal: NodeJS.Signals): Promise<void> {
    if (this.currentState === 'stopped' || this.currentState === 'stopping') {
      return;
    }

    this.currentState = 'stopping';
    this.currentState = 'stopped';
    this.logger.stopped(signal);
  }
}
