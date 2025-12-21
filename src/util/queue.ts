/**
 * A thread-safe (in the JS sense) async queue that implements the AsyncIterable interface.
 * Useful for producer-consumer patterns where the producer is event-driven.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiters: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;
  private error: Error | null = null;

  /**
   * Push an item into the queue.
   */
  push(item: T): void {
    if (this.closed) return;
    
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  /**
   * Mark the queue as done. No more items can be pushed.
   */
  done(): void {
    if (this.closed) return;
    this.closed = true;
    
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter({ value: undefined as any, done: true });
    }
  }

  /**
   * Close the queue with an error.
   */
  fail(err: Error): void {
    if (this.closed) return;
    this.error = err;
    this.closed = true;
    
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      // For the iterator, we want to throw on the next pull
      waiter({ value: undefined as any, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.error) {
        throw this.error;
      }

      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }

      if (this.closed) {
        return;
      }

      // Wait for next item or close signal
      const result = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiters.push(resolve);
      });

      if (this.error) {
        throw this.error;
      }

      if (result.done) {
        return;
      }

      yield result.value;
    }
  }
}
