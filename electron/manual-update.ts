export type UpdateResult = {
  state: 'unconfigured' | 'up-to-date' | 'available' | 'offline' | 'invalid' | 'error';
  currentVersion: string;
  availableVersion?: string;
  notes?: string;
  url?: string;
  message: string;
};

// The repository's release page is the distribution source. A release must
// actually be published there before a packaged app can report an update.
export const RELEASE_API = 'https://api.github.com/repos/karunofficial96/vhostra/releases/latest';
const RELEASE_URL = /^https:\/\/github\.com\/karunofficial96\/vhostra\/releases\/tag\/[^/?#]+$/;
const ASSET_URL = /^https:\/\/github\.com\/karunofficial96\/vhostra\/releases\/download\/[^/?#]+\/[^/?#]+$/;

export function releaseAssetName(version: string, platform: NodeJS.Platform, arch: string, linuxFormat: 'deb' | 'rpm' | 'AppImage' = 'AppImage'): string | null {
  if (!['x64', 'arm64'].includes(arch)) return null;
  const base = `Vhostra-${version.replace(/^v/, '')}`;
  if (platform === 'win32') return `${base}-windows-${arch}.exe`;
  if (platform === 'darwin') return `${base}-macos-${arch}.dmg`;
  if (platform === 'linux') {
    const packageArch = linuxFormat === 'deb' ? (arch === 'x64' ? 'amd64' : 'arm64') : linuxFormat === 'rpm' ? (arch === 'x64' ? 'x86_64' : 'aarch64') : (arch === 'x64' ? 'x86_64' : 'arm64');
    return `${base}-linux-${packageArch}.${linuxFormat}`;
  }
  return null;
}

type Version = { numbers: number[]; prerelease: string[] };
function parseVersion(value: string): Version | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  if (numbers.some(number => !Number.isSafeInteger(number))) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some(part => /^\d+$/.test(part) && (part.length > 1 && part[0] === '0' || !Number.isSafeInteger(Number(part))))) return null;
  return { numbers, prerelease };
}

export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left); const b = parseVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return Math.sign(a.numbers[i] - b.numbers[i]);
  if (!a.prerelease.length || !b.prerelease.length) return Number(!a.prerelease.length) - Number(!b.prerelease.length);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i]; const y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y);
    if (xn !== yn) return xn ? -1 : 1;
    return xn ? Math.sign(Number(x) - Number(y)) : x < y ? -1 : 1;
  }
  return 0;
}

export async function checkManualUpdate(currentVersion: string, request: typeof fetch = fetch, platform: NodeJS.Platform = process.platform, arch: string = process.arch, linuxFormat: 'deb' | 'rpm' | 'AppImage' = 'AppImage'): Promise<UpdateResult> {
  const result = (state: UpdateResult['state'], message: string, extra: Partial<UpdateResult> = {}): UpdateResult => ({ state, message, currentVersion, ...extra });
  if (!parseVersion(currentVersion)) return result('unconfigured', 'This build has an unsupported version for release checking.');
  try {
    const response = await request(RELEASE_API, { headers: { accept: 'application/vnd.github+json' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (response.status === 404) return result('unconfigured', 'No Vhostra release is published yet.');
    if (!response.ok) return result('error', 'Unable to check for updates. Try again later.');
    const reader = response.body?.getReader();
    if (!reader) return result('invalid', 'The release information is incomplete.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) return result('invalid', 'The release information is too large.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    let release: unknown;
    try { release = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return result('invalid', 'The release information is malformed.'); }
    if (!release || typeof release !== 'object') return result('invalid', 'The release information is malformed.');
    const item = release as Record<string, unknown>;
    const version = item.tag_name;
    const url = item.html_url;
    if (typeof version !== 'string' || typeof url !== 'string' || !RELEASE_URL.test(url) || item.draft === true || item.prerelease === true)
      return result('invalid', 'The release information is incomplete.');
    const comparison = compareVersions(version, currentVersion);
    if (comparison === null) return result('invalid', 'The release version is malformed.');
    if (comparison <= 0) return result('up-to-date', 'Vhostra is up to date.');
    const assetName = releaseAssetName(version, platform, arch, linuxFormat);
    const assets = item.assets;
    const asset = Array.isArray(assets) ? assets.find(entry => entry && typeof entry === 'object' && (entry as Record<string, unknown>).name === assetName) as Record<string, unknown> | undefined : undefined;
    const download = asset?.browser_download_url;
    if (!assetName || typeof download !== 'string' || !ASSET_URL.test(download) || !download.endsWith(`/${assetName}`))
      return result('unconfigured', 'A download for this operating system and architecture has not been published.');
    return result('available', `Vhostra ${version} is available.`, { availableVersion: version, url: download, notes: typeof item.body === 'string' ? item.body.slice(0, 4000) : undefined });
  } catch (error) {
    if (error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError') return result('offline', 'Offline or network unavailable. Check your connection and try again.');
    return result('error', 'Unable to check for updates. Try again later.');
  }
}
