import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, HardDrive, Wifi } from 'lucide-react';
import {
  describeEndpointLocation,
  redactEndpointUrlForDisplay,
  truncateEndpointHost,
  type EndpointLocationKind,
} from '../../shared/network/endpoint-location';

interface EndpointLocationBadgeProps {
  baseUrl: string | undefined;
  className?: string;
}

function LocationIcon({ kind }: { kind: EndpointLocationKind }) {
  const iconClass = 'w-3 h-3 shrink-0';
  if (kind === 'local') {
    return <HardDrive className={iconClass} aria-hidden />;
  }
  if (kind === 'lan') {
    return <Wifi className={iconClass} aria-hidden />;
  }
  return <Globe className={iconClass} aria-hidden />;
}

/**
 * Discreet Local / hostname badge derived solely from the configured base URL.
 * Renders nothing when no base URL is configured (silent fallback).
 */
export function EndpointLocationBadge({ baseUrl, className }: EndpointLocationBadgeProps) {
  const { t } = useTranslation();
  const trimmed = baseUrl?.trim() ?? '';

  const location = useMemo(() => describeEndpointLocation(trimmed || undefined), [trimmed]);
  const tooltip = useMemo(() => redactEndpointUrlForDisplay(trimmed || undefined), [trimmed]);

  if (!trimmed) {
    return null;
  }

  const label =
    location.kind === 'local'
      ? t('endpointLocation.local')
      : truncateEndpointHost(location.host) || t('endpointLocation.remote');

  const rootClass = [
    'inline-flex items-center gap-1 max-w-[9rem] text-[11px] leading-none text-text-muted',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={rootClass} title={tooltip || label}>
      <LocationIcon kind={location.kind} />
      <span className="truncate">{label}</span>
    </span>
  );
}
