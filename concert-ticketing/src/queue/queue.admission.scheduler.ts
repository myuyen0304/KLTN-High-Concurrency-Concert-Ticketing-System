import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AdmissionUseCase } from './application/admission.use-case';

@Injectable()
export class QueueAdmissionScheduler {
  private readonly logger = new Logger(QueueAdmissionScheduler.name);
  private running = false;

  constructor(private readonly admission: AdmissionUseCase) {}

  @Interval('queue-admission', 2000)
  async tick(): Promise<void> {
    if (this.running) return; // skip overlap if a cycle runs long
    this.running = true;
    try {
      await this.admission.execute();
    } catch (err) {
      this.logger.error(`Admission cycle failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
