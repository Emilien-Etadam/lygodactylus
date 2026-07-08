import * as net from 'net';
import * as os from 'os';

/** WSL mirrored networking exposes a virtual DNS address that is not bindable on Windows. */
const WSL_VIRTUAL_HOST_IPS = new Set(['10.255.255.254']);

export function isWslVirtualHostIp(ip: string): boolean {
  return WSL_VIRTUAL_HOST_IPS.has(ip);
}

export function isBindableIpv4OnHost(ip: string): boolean {
  if (!net.isIPv4(ip)) {
    return false;
  }

  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) {
      continue;
    }
    for (const addr of addrs) {
      const family = typeof addr.family === 'string' ? addr.family : 'IPv4';
      if (family === 'IPv4' && addr.address === ip) {
        return true;
      }
    }
  }
  return false;
}

export function pickWslWindowsHostIp(candidates: readonly string[]): string | null {
  for (const raw of candidates) {
    const ip = raw.trim();
    if (!ip || !net.isIPv4(ip) || isWslVirtualHostIp(ip)) {
      continue;
    }
    if (isBindableIpv4OnHost(ip)) {
      return ip;
    }
  }
  return null;
}
