import { describe, expect, it } from 'vitest';
import {
  isBindableIpv4OnHost,
  isWslVirtualHostIp,
  pickWslWindowsHostIp,
} from '../../main/sandbox/sandbox-network-host';

describe('sandbox-network-host', () => {
  it('flags WSL mirrored-mode virtual DNS host IP', () => {
    expect(isWslVirtualHostIp('10.255.255.254')).toBe(true);
    expect(isWslVirtualHostIp('172.22.160.1')).toBe(false);
  });

  it('skips virtual DNS IP and prefers bindable gateway candidate', () => {
    const loopback = '127.0.0.1';
    expect(isBindableIpv4OnHost(loopback)).toBe(true);

    expect(pickWslWindowsHostIp(['10.255.255.254', loopback])).toBe(loopback);
  });

  it('returns null when every candidate is virtual or unbindable', () => {
    expect(pickWslWindowsHostIp(['10.255.255.254', '8.8.8.8'])).toBeNull();
    expect(pickWslWindowsHostIp([])).toBeNull();
  });
});
