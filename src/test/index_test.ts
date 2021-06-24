import {suite} from 'uvu';
import * as assert from 'uvu/assert';
import {AsyncBroadcaster} from '../index.js';
import {TestAsyncIterable} from './test-async-iterable.js';

const AsyncBroadcasterSuite = suite('AsyncBroadcaster');

AsyncBroadcasterSuite('constructor', async () => {
  const broadcaster = new AsyncBroadcaster<string>();
  assert.ok(broadcaster);
});

AsyncBroadcasterSuite('single subscriber', async () => {
  const testIterable = new TestAsyncIterable<string>();
  const broadcaster = new AsyncBroadcaster<string>(testIterable);

  const log: Array<string> = [];

  (async () => {
    for await (const a of broadcaster.iterable) {
      log.push(`a:${a}`);
    }
  })();

  await testIterable.push('1');
  await testIterable.push('2');

  await new Promise((r) => setTimeout(r, 0));

  assert.equal(log.length, 2);
});

AsyncBroadcasterSuite('from a generator', async () => {
  async function* makeSome(n: number) {
    for (let i = 1; i <= n; i++) {
      yield i;
    }
  }

  const broadcaster = new AsyncBroadcaster<number>(makeSome(3));

  const log: Array<string> = [];

  (async () => {
    for await (const a of broadcaster.iterable) {
      log.push(`a:${a}`);
    }
  })();

  await new Promise((r) => setTimeout(r, 0));

  assert.equal(log.length, 3);
});

AsyncBroadcasterSuite(
  'broadcasts values pushed after subscribing',
  async () => {
    const testIterable = new TestAsyncIterable<string>();
    const broadcaster = new AsyncBroadcaster<string>(testIterable);

    const log: Array<string> = [];

    await testIterable.push('1');
    await testIterable.push('2');

    (async () => {
      for await (const a of broadcaster.iterable) {
        log.push(`a:${a}`);
      }
    })();
    (async () => {
      for await (const b of broadcaster.iterable) {
        log.push(`b:${b}`);
      }
    })();

    await testIterable.push('3');
    await testIterable.push('4');

    await new Promise((r) => setTimeout(r, 0));

    assert.equal(log.length, 4);

    await testIterable.push('5');
    testIterable.push('6');
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(log.length, 8);
  }
);

AsyncBroadcasterSuite('buffers for slow listeners', async () => {
  const testIterable = new TestAsyncIterable<string>();
  const broadcaster = new AsyncBroadcaster<string>(testIterable);

  const log: Array<string> = [];
  let makeGo!: () => void;
  const go = new Promise<void>((res) => (makeGo = res));

  // Fast subscriber
  (async () => {
    for await (const a of broadcaster.iterable) {
      log.push(`a:${a}`);
    }
  })();
  // Slow subscriber
  (async () => {
    for await (const b of broadcaster.iterable) {
      await go;
      log.push(`b:${b}`);
    }
  })();

  await testIterable.push('1');
  await testIterable.push('2');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(log.length, 2);

  makeGo();

  await new Promise((r) => setTimeout(r, 0));
  assert.equal(log.length, 4);
});

AsyncBroadcasterSuite('cleans up when iterable not used', async () => {
  const testIterable = new TestAsyncIterable<string>();
  const broadcaster = new AsyncBroadcaster<string>(testIterable);

  const log: Array<string> = [];

  (async () => {
    for await (const a of broadcaster.iterable) {
      log.push(`a:${a}`);
      break;
    }
  })();

  await testIterable.push('1');
  await testIterable.push('2');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((broadcaster as any)._indices.size, 0);
});

AsyncBroadcasterSuite('abort signal', async () => {
  const testIterable = new TestAsyncIterable<string>();
  const broadcaster = new AsyncBroadcaster<string>(testIterable);
  const abortController = new AbortController();
  const {signal} = abortController;

  const log: Array<string> = [];

  (async () => {
    for await (const a of broadcaster.iterable.values({signal})) {
      log.push(`a:${a}`);
    }
  })();

  await testIterable.push('1');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((broadcaster as any)._indices.size, 1);

  abortController.abort();

  await new Promise((r) => setTimeout(r, 0));

  assert.equal(log.length, 1);
  assert.equal((broadcaster as any)._indices.size, 0);
});

AsyncBroadcasterSuite.run();
