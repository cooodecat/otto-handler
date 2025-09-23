import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

interface LogEntry {
  executionId: string;
  timestamp: Date;
  message: string;
  level: string;
}

class CircularBuffer<T> {
  private buffer: T[];
  private pointer = 0;
  private size = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.pointer] = item;
    this.pointer = (this.pointer + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  toArray(): T[] {
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    return [
      ...this.buffer.slice(this.pointer),
      ...this.buffer.slice(0, this.pointer),
    ];
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.pointer = 0;
    this.size = 0;
  }

  getSize(): number {
    return this.size;
  }

  isFull(): boolean {
    return this.size === this.capacity;
  }
}

@Injectable()
export class LogBufferService {
  private readonly logger = new Logger(LogBufferService.name);
  private buffers = new Map<string, CircularBuffer<LogEntry>>();
  private readonly defaultBufferSize = 1000;

  constructor(private eventEmitter: EventEmitter2) {}

  addLogs(executionId: string, logs: LogEntry[]): void {
    if (!this.buffers.has(executionId)) {
      this.buffers.set(executionId, new CircularBuffer(this.defaultBufferSize));
      this.logger.log(`Created buffer for execution ${executionId}`);
    }

    const buffer = this.buffers.get(executionId)!;
    logs.forEach((log) => buffer.push(log));

    this.logger.debug(
      `Added ${logs.length} logs to buffer for execution ${executionId}. Buffer size: ${buffer.getSize()}`,
    );
    
    // Emit event for WebSocket broadcasting
    this.eventEmitter.emit('logs.new', { executionId, logs });
  }

  getRecentLogs(executionId: string, limit?: number): LogEntry[] {
    const buffer = this.buffers.get(executionId);
    if (!buffer) {
      this.logger.debug(`No buffer found for execution ${executionId}`);
      return [];
    }

    const logs = buffer.toArray();

    if (limit && limit > 0) {
      return logs.slice(-limit);
    }

    return logs;
  }

  clearBuffer(executionId: string): void {
    const buffer = this.buffers.get(executionId);
    if (buffer) {
      buffer.clear();
      this.buffers.delete(executionId);
      this.logger.log(
        `Cleared and removed buffer for execution ${executionId}`,
      );
    }
  }

  clearAllBuffers(): void {
    const executionIds = Array.from(this.buffers.keys());
    executionIds.forEach((executionId) => this.clearBuffer(executionId));
    this.logger.log(`Cleared all ${executionIds.length} buffers`);
  }

  getBufferStats(): { executionId: string; size: number; isFull: boolean }[] {
    const stats: { executionId: string; size: number; isFull: boolean }[] = [];

    this.buffers.forEach((buffer, executionId) => {
      stats.push({
        executionId,
        size: buffer.getSize(),
        isFull: buffer.isFull(),
      });
    });

    return stats;
  }

  getTotalBufferedLogs(): number {
    let total = 0;
    this.buffers.forEach((buffer) => {
      total += buffer.getSize();
    });
    return total;
  }
}
