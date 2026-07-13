import { createHash } from 'node:crypto';
import Store, { type Options as StoreOptions } from 'electron-store';
import type { CatalogSource } from '../../shared/catalog-types';

export function catalogSourceIdForUrl(url: string): string {
  return `ext-${createHash('sha256').update(url).digest('hex').slice(0, 10)}`;
}

class CatalogSourcesStore {
  private store: Store<{ sources: CatalogSource[] }>;

  constructor() {
    const storeOptions: StoreOptions<{ sources: CatalogSource[] }> & {
      projectName?: string;
    } = {
      name: 'catalog-sources',
      projectName: 'lygodactylus',
      defaults: {
        sources: [],
      },
    };
    this.store = new Store<{ sources: CatalogSource[] }>(storeOptions);
  }

  list(): CatalogSource[] {
    return this.store.get('sources', []);
  }

  get(id: string): CatalogSource | undefined {
    return this.list().find((source) => source.id === id);
  }

  save(source: CatalogSource): void {
    const sources = this.list().filter((item) => item.id !== source.id);
    sources.push(source);
    this.store.set('sources', sources);
  }

  remove(id: string): boolean {
    const sources = this.list();
    const next = sources.filter((source) => source.id !== id);
    if (next.length === sources.length) {
      return false;
    }
    this.store.set('sources', next);
    return true;
  }
}

export const catalogSourcesStore = new CatalogSourcesStore();
