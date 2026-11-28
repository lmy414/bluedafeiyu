import { pathToFileURL } from 'node:url';

export function runCli(url: string, main: () => Promise<unknown>) {
  if (!process.argv[1] || pathToFileURL(process.argv[1]).href !== url) return;
  main().then(result => {
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`缺少 ${key}`);
  return value;
}
