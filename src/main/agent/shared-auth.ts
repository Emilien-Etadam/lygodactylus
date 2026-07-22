import { ModelRuntime } from '@earendil-works/pi-coding-agent';

/**
 * Shared ModelRuntime singleton for the Electron main process.
 * Replaces AuthStorage + ModelRegistry.create() removed from the public SDK
 * surface in pi-coding-agent ≥0.80.8 (ModelRuntime facade).
 *
 * create() is async; callers must await. Concurrent callers share one promise
 * (no double-create race on the single-threaded main process).
 */
let sharedModelRuntimePromise: Promise<ModelRuntime> | null = null;

export function getSharedModelRuntime(): Promise<ModelRuntime> {
  if (!sharedModelRuntimePromise) {
    // Local-first app: never refresh remote model catalogs at create-time.
    sharedModelRuntimePromise = ModelRuntime.create({
      allowModelNetwork: false,
    });
  }
  return sharedModelRuntimePromise;
}

export { ModelRuntime };
