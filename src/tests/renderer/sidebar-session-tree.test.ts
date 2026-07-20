import { describe, expect, it } from 'vitest';
import type { ChatFolder, Session } from '../../renderer/types';
import {
  buildSessionForest,
  partitionSessionsByFolder,
} from '../../renderer/utils/sidebar-session-tree';

function session(
  partial: Partial<Session> & Pick<Session, 'id' | 'title'>
): Session {
  return {
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    mode: 'act',
    autonomy: 'normal',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe('sidebar-session-tree', () => {
  it('nests sub-chats under their parent', () => {
    const forest = buildSessionForest([
      session({ id: 'p', title: 'Parent', updatedAt: 20 }),
      session({ id: 'c', title: 'Child', parentSessionId: 'p', updatedAt: 30 }),
      session({ id: 'r', title: 'Root', updatedAt: 10 }),
    ]);

    expect(forest.map((n) => n.session.id)).toEqual(['p', 'r']);
    expect(forest[0].children.map((n) => n.session.id)).toEqual(['c']);
  });

  it('partitions top-level sessions by folder while keeping nesting', () => {
    const folders: ChatFolder[] = [
      { id: 'f1', name: 'Alpha', collapsed: false, position: 0, createdAt: 1 },
    ];
    const { folderTrees, rootNodes } = partitionSessionsByFolder(
      [
        session({ id: 'p', title: 'In folder', folderId: 'f1', updatedAt: 5 }),
        session({
          id: 'c',
          title: 'Sub',
          folderId: 'f1',
          parentSessionId: 'p',
          updatedAt: 6,
        }),
        session({ id: 'r', title: 'Loose', updatedAt: 4 }),
      ],
      folders
    );

    expect(folderTrees).toHaveLength(1);
    expect(folderTrees[0].nodes.map((n) => n.session.id)).toEqual(['p']);
    expect(folderTrees[0].nodes[0].children.map((n) => n.session.id)).toEqual(['c']);
    expect(rootNodes.map((n) => n.session.id)).toEqual(['r']);
  });
});
