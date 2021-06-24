interface AsyncBroadcasterIterable<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>;
  values(options: {signal?: AbortSignal}): AsyncIterableIterator<T>;
}

/**
 * An object that broadcasts values out to multiple listeners via async
 * iterables.
 */
export class AsyncBroadcaster<T = unknown> {
  private _buffer: Array<T> = [];
  private _nextGeneratorID = 0;

  // Tracks which index into the buffer each active generator is at
  private _indices = new Map<number, number>();

  // A promise to resolve when we get a new value. This continues the
  // every generator's loop to yield the new value
  private _nextValue?: Promise<void>;
  private _resolveNextValue?: () => void;

  iterable: AsyncBroadcasterIterable<T> = {
    [Symbol.asyncIterator]: () => {
      return this._values();
    },
    values: (options: {signal?: AbortSignal} = {}) => this._values(options),
  };

  constructor(iterable?: AsyncIterable<T>) {
    if (iterable !== undefined) {
      this._pushAll(iterable);
    }
  }

  private async _pushAll(iterable: AsyncIterable<T>) {
    for await (const v of iterable) {
      this._buffer.push(v);
      // Notify every listener waiting on a value
      this._resolveNextValue?.();
      this._nextValue = this._resolveNextValue = undefined;
    }
  }

  /**
   * Returns a new async iterable of values
   */
  private async *_values(
    options: {signal?: AbortSignal} = {}
  ): AsyncGenerator<T, void, any> {
    const {signal} = options;
    const id = this._nextGeneratorID++;
    const waitOrAbort = makeWaitOrAbort(signal);

    // Start one past the end of the buffer to only read new values
    this._indices.set(id, this._buffer.length);

    try {
      while (signal?.aborted !== true) {
        let index = this._indices.get(id)!;

        // We're at the end of the buffer, wait for a value
        if (index === this._buffer.length) {
          this._nextValue ??= new Promise<void>((res) => {
            this._resolveNextValue = res;
          });
          try {
            await waitOrAbort(this._nextValue);
          } finally {
            if (signal?.aborted) {
              this._cleanup(id);
              return;
            }
          }

          // Update index, since it might have changed while we waited.
          // We do not need to check if we're at the end again.
          index = this._indices.get(id)!;
        }
        const v = this._buffer[index];
        this._indices.set(id, ++index);
        this._trim();
        yield v!;
      }
    } finally {
      // If the generator is closed by break/throw/return from a for await/of
      // loop, the finally clause will run.
      this._cleanup(id);
      return;
    }
  }

  private _cleanup(id: number) {
    this._indices.delete(id);
    this._trim();
  }

  /**
   * Trim the buffer and update all indices
   */
  private _trim() {
    let minIndex = Math.min(...this._indices.values());
    if (minIndex > 0) {
      this._buffer.splice(0, minIndex);
      for (const [i, n] of this._indices.entries()) {
        this._indices.set(i, n - minIndex);
      }
    }
  }
}

/**
 * Create a function that wraps a Promise to reject if an AbortSignal aborts.
 */
const makeWaitOrAbort = (signal?: AbortSignal) => {
  let abort: (e: unknown) => void;
  signal?.addEventListener('abort', (e) => abort(e));
  return (v: unknown) =>
    new Promise(async (resolve, reject) => {
      abort = reject;
      try {
        resolve(await v);
      } catch (e) {
        reject(e);
      }
    });
};
