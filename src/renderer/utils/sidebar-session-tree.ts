import type { ChatFolder, Session } from '../types';

export interface SessionTreeNode {
  session: Session;
  children: SessionTreeNode[];
}

/**
 * Build a forest of sessions: top-level nodes have no resolvable parent;
 * sub-chats nest under their parent when the parent exists in the set.
 */
export function buildSessionForest(sessions: Session[]): SessionTreeNode[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, Session[]>();

  for (const session of sessions) {
    const parentId = session.parentSessionId;
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(session);
      childrenByParent.set(parentId, list);
    }
  }

  const sortByRecency = (a: Session, b: Session): number =>
    (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);

  const buildNode = (session: Session): SessionTreeNode => {
    const children = (childrenByParent.get(session.id) ?? [])
      .slice()
      .sort(sortByRecency)
      .map(buildNode);
    return { session, children };
  };

  return sessions
    .filter((session) => {
      const parentId = session.parentSessionId;
      return !parentId || !byId.has(parentId);
    })
    .slice()
    .sort(sortByRecency)
    .map(buildNode);
}

export function partitionSessionsByFolder(
  sessions: Session[],
  folders: ChatFolder[]
): {
  folderTrees: Array<{ folder: ChatFolder; nodes: SessionTreeNode[] }>;
  rootNodes: SessionTreeNode[];
} {
  const forest = buildSessionForest(sessions);
  const folderIds = new Set(folders.map((folder) => folder.id));

  const folderTrees = folders
    .slice()
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
    .map((folder) => ({
      folder,
      nodes: forest.filter((node) => node.session.folderId === folder.id),
    }));

  const rootNodes = forest.filter(
    (node) => !node.session.folderId || !folderIds.has(node.session.folderId)
  );

  return { folderTrees, rootNodes };
}
