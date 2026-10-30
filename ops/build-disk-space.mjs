import fs from 'node:fs';
import path from 'node:path';

// Check the filesystem that will receive the build, including bind/loop mounts.
export function assertBuildDiskSpace(directories, {minimumMiB = Number(process.env.BUILD_MIN_DISK_MB || 2048), statfs = fs.statfsSync, exists = fs.existsSync} = {}) {
  if (!Number.isSafeInteger(minimumMiB) || minimumMiB < 0) throw new Error('BUILD_MIN_DISK_MB must be a non-negative integer');
  return [...new Set(directories.filter(Boolean).map(directory => path.resolve(directory)))].map(directory => {
    let target = directory;
    while (!exists(target) && path.dirname(target) !== target) target = path.dirname(target);
    const disk = statfs(target);
    const availableMiB = Math.floor(disk.bavail * disk.bsize / 1048576);
    if (availableMiB < minimumMiB) throw new Error(`Build disk space at ${directory}: ${availableMiB} MiB available, ${minimumMiB} MiB required; current release unchanged`);
    return {directory, availableMiB, minimumMiB};
  });
}
