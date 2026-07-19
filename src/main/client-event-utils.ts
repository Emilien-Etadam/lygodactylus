import type { ClientEvent } from '../renderer/types';

export function eventRequiresSessionManager(event: ClientEvent): boolean {
  switch (event.type) {
    case 'session.start':
    case 'session.continue':
    case 'session.stop':
    case 'session.delete':
    case 'session.batchDelete':
    case 'session.list':
    case 'session.getMessages':
    case 'session.getTraceSteps':
    case 'session.compact':
    case 'session.handoff':
    case 'session.forkFromMessage':
    case 'session.rewindToMessage':
    case 'session.setMode':
    case 'session.getMode':
    case 'permission.response':
    case 'question.response':
      return true;
    default:
      return false;
  }
}
