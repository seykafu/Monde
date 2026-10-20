import type { BatchRequest, BatchResult, BatchStatus } from '../mindClient.js';

/** Explicit delivery lets tests keep batches pending across a runner restart. */
export class FakeBatches {
  readonly batches: { id: string; requests: BatchRequest[]; results?: BatchResult[] }[] = [];
  async *listBatches(): AsyncIterable<BatchStatus & { created_at: string }> {
    for (const b of [...this.batches].reverse()) yield { ...await this.retrieveBatch(b.id), created_at: new Date().toISOString() };
  }
  async createBatch(requests: BatchRequest[]): Promise<BatchStatus> {
    const id = `batch_${this.batches.length}`;
    this.batches.push({ id, requests: structuredClone(requests) });
    return { id, processing_status: 'in_progress' };
  }
  deliverBatch(id: string, results: BatchResult[]): void {
    this.batches.find(b => b.id === id)!.results = results;
  }
  async retrieveBatch(id: string): Promise<BatchStatus> {
    return { id, processing_status: this.batches.find(b => b.id === id)!.results ? 'ended' : 'in_progress' };
  }
  async *batchResults(id: string): AsyncIterable<BatchResult> {
    yield* this.batches.find(b => b.id === id)!.results ?? [];
  }
}
