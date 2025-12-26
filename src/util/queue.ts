export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiters: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;
  private error: Error | null = null;

  push(item: T): void {
    if (this.closed) return;
    
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.queue.push(item);
    }
  }

  done(): void {
    if (this.closed) return;
    this.closed = true;
    
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter({ value: undefined as any, done: true });
    }
  }

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
