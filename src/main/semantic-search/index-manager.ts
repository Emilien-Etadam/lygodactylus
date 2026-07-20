import path from 'node:path';
import { app } from 'electron';
import { configStore } from '../config/config-store';
import { MemoryLLMClient } from '../memory/memory-llm-client';
import { SemanticIndexService } from './index-service';

let sharedService: SemanticIndexService | null = null;
let sharedClient: MemoryLLMClient | null = null;

function defaultStorageRoot(): string {
  return path.join(app.getPath('userData'), 'semantic-index');
}

/** Process-wide semantic index service (lazy). */
export function getSemanticIndexService(): SemanticIndexService {
  if (!sharedService) {
    sharedClient = new MemoryLLMClient(() => configStore.getAll());
    sharedService = new SemanticIndexService({
      storageRoot: defaultStorageRoot(),
      embed: (text) => sharedClient!.embed(text),
      getRerankerConfig: () => configStore.getAll().memoryRuntime.memoryReranker,
    });
  }
  return sharedService;
}

/** Test-only: replace or clear the singleton. */
export function setSemanticIndexServiceForTests(service: SemanticIndexService | null): void {
  if (sharedService && sharedService !== service) {
    sharedService.close();
  }
  sharedService = service;
}
