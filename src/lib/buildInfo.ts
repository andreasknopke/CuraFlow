/**
 * CuraFlow — Build Info
 *
 * Reads commit SHA information injected by Vite at build time
 * via `globalThis.__CURAFLOW_BUILD_INFO__`.
 *
 * @module lib/buildInfo
 */

interface RawBuildInfo {
  commitSha?: unknown;
  commitShortSha?: unknown;
}

interface NormalizedBuildInfo {
  commitSha: string;
  commitShortSha: string;
}

function normalizeBuildInfo(buildInfo: RawBuildInfo | null | undefined): NormalizedBuildInfo {
  if (!buildInfo || typeof buildInfo !== 'object') {
    return { commitSha: '', commitShortSha: '' };
  }

  const commitSha =
    typeof buildInfo.commitSha === 'string' ? buildInfo.commitSha.trim() : '';
  const explicitShortSha =
    typeof buildInfo.commitShortSha === 'string' ? buildInfo.commitShortSha.trim() : '';
  const commitShortSha = explicitShortSha || (commitSha ? commitSha.slice(0, 7) : '');

  return { commitSha, commitShortSha };
}

export function getBuildInfo(): NormalizedBuildInfo {
  return normalizeBuildInfo(globalThis.__CURAFLOW_BUILD_INFO__);
}
