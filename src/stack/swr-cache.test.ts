import { describe, expect, it } from "vitest";
import { createSwrCache } from "./swr-cache";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

function loader() {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return `v${calls}`;
  };
  return { load, calls: () => calls };
}

describe("createSwrCache", () => {
  it("loads once and serves the value while fresh", async () => {
    const c = clock();
    const cache = createSwrCache<string, string>({ freshMs: 100, staleMs: 100, now: c.now });
    const { load, calls } = loader();
    expect(await cache.get("k", load)).toBe("v1");
    c.tick(50);
    expect(await cache.get("k", load)).toBe("v1");
    expect(calls()).toBe(1);
  });

  it("serves a stale value at once and refreshes behind it", async () => {
    const c = clock();
    const cache = createSwrCache<string, string>({ freshMs: 100, staleMs: 100, now: c.now });
    const { load, calls } = loader();
    await cache.get("k", load);
    c.tick(150);
    expect(await cache.get("k", load)).toBe("v1");
    expect(calls()).toBe(2);
    // The refresh has landed by now, and is fresh again.
    await Promise.resolve();
    expect(await cache.get("k", load)).toBe("v2");
    expect(calls()).toBe(2);
  });

  it("waits for a new value once the entry has expired", async () => {
    const c = clock();
    const cache = createSwrCache<string, string>({ freshMs: 100, staleMs: 100, now: c.now });
    const { load } = loader();
    await cache.get("k", load);
    c.tick(250);
    expect(await cache.get("k", load)).toBe("v2");
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const cache = createSwrCache<string, string>({ freshMs: 100, staleMs: 100 });
    const { load, calls } = loader();
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect([a, b]).toEqual(["v1", "v1"]);
    expect(calls()).toBe(1);
  });

  it("does not remember a failed load", async () => {
    const cache = createSwrCache<string, string>({ freshMs: 100, staleMs: 100 });
    let attempts = 0;
    const flaky = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("boom");
      return "ok";
    };
    await expect(cache.get("k", flaky)).rejects.toThrow("boom");
    expect(await cache.get("k", flaky)).toBe("ok");
  });

  it("clears one key or all of them", async () => {
    const cache = createSwrCache<string, string>({ freshMs: 100, staleMs: 100 });
    const { load, calls } = loader();
    await cache.get("a", load);
    await cache.get("b", load);
    cache.clear("a");
    await cache.get("a", load);
    await cache.get("b", load);
    expect(calls()).toBe(3);
    cache.clear();
    await cache.get("b", load);
    expect(calls()).toBe(4);
  });
});
