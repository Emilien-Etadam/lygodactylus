import * as fs from 'fs';
import * as path from 'path';
import type {
  ContentBlock,
  FileAttachmentContent,
  ServerEvent,
  Session,
} from '../../renderer/types';
import { SandboxSync } from '../sandbox/sandbox-sync';
import { log, logError } from '../utils/logger';

interface ProcessFileAttachmentsOptions {
  session: Session;
  content: ContentBlock[];
  sendToRenderer: (event: ServerEvent) => void;
}

export async function processFileAttachments({
  session,
  content,
  sendToRenderer,
}: ProcessFileAttachmentsOptions): Promise<ContentBlock[]> {
  const processedContent: ContentBlock[] = [];

  for (const block of content) {
    if (block.type !== 'file_attachment') {
      processedContent.push(block);
      continue;
    }

    const fileBlock = block as FileAttachmentContent;

    try {
      const tmpDir = path.join(session.cwd || process.cwd(), '.tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
        log('[SessionManager] Created .tmp directory:', tmpDir);
      }

      const sourcePath = (fileBlock.relativePath || '').trim();
      const fallbackFilename = fileBlock.filename || sourcePath || `attachment-${Date.now()}`;
      const destFilename = path.basename(fallbackFilename);
      if (!destFilename) {
        continue;
      }

      const destPath = path.join(tmpDir, destFilename);
      let actualSize = 0;

      if (sourcePath && fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath);
        actualSize = fs.statSync(destPath).size;
        log('[SessionManager] Copied file:', sourcePath, '->', destPath, `(${actualSize} bytes)`);
      } else if (fileBlock.inlineDataBase64) {
        const buffer = Buffer.from(fileBlock.inlineDataBase64, 'base64');
        fs.writeFileSync(destPath, buffer);
        actualSize = buffer.length;
        log('[SessionManager] Wrote file from inline data:', destPath, `(${actualSize} bytes)`);
      } else {
        logError(
          '[SessionManager] Source file not found and inline data missing:',
          sourcePath || '(empty path)'
        );
        continue;
      }

      const sandboxPath = SandboxSync.getSandboxPath(session.id);
      if (sandboxPath) {
        const sandboxRelativePath = `.tmp/${destFilename}`;
        log('[SessionManager] Syncing attached file to sandbox:', sandboxRelativePath);
        const syncResult = await SandboxSync.syncFileToSandbox(
          session.id,
          destPath,
          sandboxRelativePath
        );
        if (syncResult.success) {
          log('[SessionManager] File synced to sandbox:', syncResult.sandboxPath);
        } else {
          logError('[SessionManager] Failed to sync file to sandbox:', syncResult.error);
        }
      } else {
        const { LimaSync } = await import('../sandbox/lima-sync');
        const limaSandboxPath = LimaSync.getSandboxPath(session.id);
        if (limaSandboxPath) {
          const sandboxRelativePath = `.tmp/${destFilename}`;
          log('[SessionManager] Syncing attached file to Lima sandbox:', sandboxRelativePath);
          const syncResult = await LimaSync.syncFileToSandbox(
            session.id,
            destPath,
            sandboxRelativePath
          );
          if (syncResult.success) {
            log('[SessionManager] File synced to Lima sandbox:', syncResult.sandboxPath);
          } else {
            logError('[SessionManager] Failed to sync file to Lima sandbox:', syncResult.error);
          }
        }
      }

      const relativePathFromCwd = path.join('.tmp', destFilename);
      const restFileBlock = { ...fileBlock };
      delete restFileBlock.inlineDataBase64;
      processedContent.push({
        ...restFileBlock,
        relativePath: relativePathFromCwd,
        size: actualSize,
      });
    } catch (error) {
      logError('[SessionManager] Error copying file:', error);
      sendToRenderer({
        type: 'error',
        payload: {
          message: `Failed to process file attachment: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    }
  }

  return processedContent;
}
