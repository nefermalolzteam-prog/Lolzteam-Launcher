import { spawn } from 'node:child_process';
import log from 'electron-log/main';

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export const computeConnectCacheHdr = (login: string): string => {
  const value = crc32(Buffer.from(login, 'utf8'));
  return `${value.toString(16)}1`;
};

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$dataB64 = [Console]::In.ReadLine()
$entropyB64 = [Console]::In.ReadLine()
$data = [Convert]::FromBase64String($dataB64)
$entropy = [Convert]::FromBase64String($entropyB64)
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
$result = [System.Security.Cryptography.ProtectedData]::Protect($data, $entropy, $scope)
[Console]::Out.WriteLine([BitConverter]::ToString($result).Replace('-','').ToLower())
`;

const encodeForPowerShell = (script: string): string =>
  Buffer.from(script, 'utf16le').toString('base64');

export const dpapiProtect = (data: Buffer, entropy: Buffer): Promise<string> =>
  new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('DPAPI is only available on Windows'));
      return;
    }

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeForPowerShell(PS_SCRIPT)],
      { windowsHide: true },
    );

    let stdout = '';
    let stderr = '';

    // PowerShell can hang indefinitely (AV scan, cold .NET JIT, wedged console
    // host) — without a deadline the whole login would be stuck forever.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30_000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('DPAPI helper timed out after 30s'));
        return;
      }
      if (code !== 0) {
        reject(new Error(`DPAPI helper exited with ${code}: ${stderr.trim()}`));
        return;
      }
      const hex = stdout.trim();
      if (!/^([0-9a-f]{2})+$/.test(hex)) {
        reject(new Error(`DPAPI helper returned invalid output: ${hex.slice(0, 80)}`));
        return;
      }
      resolve(hex);
    });

    child.stdin.on('error', (err) => {
      log.warn('[dpapi] helper stdin closed early', err);
    });

    child.stdin.write(`${data.toString('base64')}\n`);
    child.stdin.write(`${entropy.toString('base64')}\n`);
    child.stdin.end();
  });
