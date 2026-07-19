import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, Square } from 'lucide-react';
import { useAppStore } from '../../store';
import { toggleSpeechSynthesis } from '../../utils/speech-synthesis';

interface SpeakButtonProps {
  messageId: string;
  text: string;
  className?: string;
}

export const SpeakButton = memo(function SpeakButton({
  messageId,
  text,
  className = 'w-6 h-6 flex items-center justify-center rounded-md bg-surface-muted hover:bg-surface-active transition-colors',
}: SpeakButtonProps) {
  const { t, i18n } = useTranslation();
  const isSpeaking = useAppStore((s) => s.speakingMessageId === messageId);

  const handleClick = useCallback(() => {
    if (!text) return;
    toggleSpeechSynthesis({
      messageId,
      markdown: text,
      uiLanguage: i18n.language,
    });
  }, [i18n.language, messageId, text]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={className}
      title={isSpeaking ? t('messageCard.stopSpeaking') : t('messageCard.speakMessage')}
      aria-pressed={isSpeaking}
    >
      {isSpeaking ? (
        <Square className="w-3 h-3 text-accent fill-current" />
      ) : (
        <Volume2 className="w-3 h-3 text-text-muted" />
      )}
    </button>
  );
});
