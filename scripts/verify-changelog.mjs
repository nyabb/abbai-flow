import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const repositoryUrl = packageJson.repository.url.replace(/\.git$/, '');
const releaseEntries = [...changelog.matchAll(/^#{1,6} \[(\d+\.\d+\.\d+)\]\((https?:\/\/[^)]+)\)/gm)];

if (releaseEntries.length === 0) {
  console.error('CHANGELOG.md does not contain a versioned release heading.');
  process.exit(1);
}

const packageEntry = releaseEntries.find(([, version]) => version === packageJson.version);
if (!packageEntry) {
  console.error(`CHANGELOG.md is missing a release entry for package version ${packageJson.version}.`);
  process.exit(1);
}

const [, latestVersion, latestUrl] = releaseEntries[0];

if (latestVersion !== packageJson.version) {
  console.error(
    `CHANGELOG.md has ${packageJson.version}, but its newest release entry is ${latestVersion}.`,
  );
  process.exit(1);
}

if (!latestUrl.startsWith(`${repositoryUrl}/`)) {
  console.error(`The latest changelog link must point to ${repositoryUrl}.`);
  process.exit(1);
}

console.log(`Changelog verified: ${latestVersion} (${repositoryUrl}).`);
