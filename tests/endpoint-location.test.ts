import { describe, expect, it } from 'vitest';
import {
  describeEndpointLocation,
  isLocalNetworkHostname,
  isRfc1918Hostname,
  redactEndpointUrlForDisplay,
  truncateEndpointHost,
} from '../src/shared/network/endpoint-location';

describe('describeEndpointLocation', () => {
  it('classifies loopback IPv4 / IPv6 / localhost as local', () => {
    expect(describeEndpointLocation('http://127.0.0.1:11434/v1')).toEqual({
      kind: 'local',
      host: '127.0.0.1',
    });
    expect(describeEndpointLocation('http://localhost:8000/v1')).toEqual({
      kind: 'local',
      host: 'localhost',
    });
    expect(describeEndpointLocation('http://[::1]:8082/v1')).toEqual({
      kind: 'local',
      host: '::1',
    });
    expect(describeEndpointLocation('localhost:11434')).toEqual({
      kind: 'local',
      host: 'localhost',
    });
  });

  it('classifies RFC1918 addresses as lan', () => {
    expect(describeEndpointLocation('http://192.168.1.50:11434/v1')).toEqual({
      kind: 'lan',
      host: '192.168.1.50',
    });
    expect(describeEndpointLocation('http://10.0.0.12:8000/v1')).toEqual({
      kind: 'lan',
      host: '10.0.0.12',
    });
    expect(describeEndpointLocation('http://172.16.4.8:8080/v1')).toEqual({
      kind: 'lan',
      host: '172.16.4.8',
    });
    expect(describeEndpointLocation('http://172.31.255.1:8080/v1')).toEqual({
      kind: 'lan',
      host: '172.31.255.1',
    });
  });

  it('classifies .local hostnames as lan', () => {
    expect(describeEndpointLocation('http://nas.local:11434/v1')).toEqual({
      kind: 'lan',
      host: 'nas.local',
    });
    expect(describeEndpointLocation('http://printer.local/v1')).toEqual({
      kind: 'lan',
      host: 'printer.local',
    });
  });

  it('classifies public domains as remote', () => {
    expect(describeEndpointLocation('https://api.openai.com/v1')).toEqual({
      kind: 'remote',
      host: 'api.openai.com',
    });
    expect(describeEndpointLocation('https://openrouter.ai/api/v1')).toEqual({
      kind: 'remote',
      host: 'openrouter.ai',
    });
  });

  it('defaults invalid or empty URLs to remote', () => {
    expect(describeEndpointLocation(undefined)).toEqual({ kind: 'remote', host: '' });
    expect(describeEndpointLocation('')).toEqual({ kind: 'remote', host: '' });
    expect(describeEndpointLocation('   ')).toEqual({ kind: 'remote', host: '' });
    expect(describeEndpointLocation('http://')).toEqual({ kind: 'remote', host: '' });
    expect(describeEndpointLocation('not a url :::')).toEqual({ kind: 'remote', host: '' });
  });

  it('does not treat nearby-but-public ranges as lan', () => {
    expect(describeEndpointLocation('http://172.15.0.1:8080').kind).toBe('remote');
    expect(describeEndpointLocation('http://172.32.0.1:8080').kind).toBe('remote');
    expect(describeEndpointLocation('http://11.0.0.1:8080').kind).toBe('remote');
  });
});

describe('RFC1918 / .local helpers', () => {
  it('detects private IPv4 and .local hosts', () => {
    expect(isRfc1918Hostname('10.1.2.3')).toBe(true);
    expect(isRfc1918Hostname('192.168.0.1')).toBe(true);
    expect(isRfc1918Hostname('172.20.0.1')).toBe(true);
    expect(isRfc1918Hostname('8.8.8.8')).toBe(false);
    expect(isLocalNetworkHostname('foo.local')).toBe(true);
    expect(isLocalNetworkHostname('foo.locals')).toBe(false);
  });
});

describe('redactEndpointUrlForDisplay', () => {
  it('strips credentials, query string and fragment', () => {
    expect(
      redactEndpointUrlForDisplay('https://user:secret@api.example.com/v1?api_key=sk-test#frag')
    ).toBe('https://api.example.com/v1');
    expect(redactEndpointUrlForDisplay('http://127.0.0.1:11434/v1')).toBe(
      'http://127.0.0.1:11434/v1'
    );
    expect(redactEndpointUrlForDisplay('localhost:11434/v1')).toBe('localhost:11434/v1');
  });

  it('never leaks api keys from unparseable URLs either', () => {
    expect(redactEndpointUrlForDisplay('https://bad url?api_key=sk-leaked')).not.toContain(
      'sk-leaked'
    );
  });
});

describe('truncateEndpointHost', () => {
  it('truncates long hostnames with an ellipsis', () => {
    expect(truncateEndpointHost('short')).toBe('short');
    expect(truncateEndpointHost('verylonghostname.example.com', 12)).toBe('verylonghos…');
  });
});
