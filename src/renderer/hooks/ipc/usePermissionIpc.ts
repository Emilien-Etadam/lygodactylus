import { useCallback } from 'react';
import type { ClientEvent, PermissionResult } from '../../types';

export interface PermissionQuestionIpcDeps {
  send: (event: ClientEvent) => void;
  setPendingPermission: (permission: null) => void;
  setPendingQuestion: (question: null) => void;
}

export function usePermissionQuestionIpc({
  send,
  setPendingPermission,
  setPendingQuestion,
}: PermissionQuestionIpcDeps) {
  const respondToPermission = useCallback(
    (toolUseId: string, result: PermissionResult) => {
      send({
        type: 'permission.response',
        payload: { toolUseId, result },
      });
      setPendingPermission(null);
    },
    [send, setPendingPermission]
  );

  const respondToQuestion = useCallback(
    (questionId: string, answer: string) => {
      send({
        type: 'question.response',
        payload: { questionId, answer },
      });
      setPendingQuestion(null);
    },
    [send, setPendingQuestion]
  );

  return { respondToPermission, respondToQuestion };
}

export interface SudoPasswordIpcDeps {
  send: (event: ClientEvent) => void;
  setPendingSudoPassword: (password: null) => void;
}

export function useSudoPasswordIpc({ send, setPendingSudoPassword }: SudoPasswordIpcDeps) {
  const respondToSudoPassword = useCallback(
    (toolUseId: string, password: string | null) => {
      send({
        type: 'sudo.password.response',
        payload: { toolUseId, password },
      });
      setPendingSudoPassword(null);
    },
    [send, setPendingSudoPassword]
  );

  return { respondToSudoPassword };
}
