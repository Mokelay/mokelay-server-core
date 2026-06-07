#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const packageJsonPath = resolve(process.cwd(), "package.json");

function readPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8"));
}

function runNpm(args, options = {}) {
  const result = spawnSync(npmCommand, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    console.error(`Failed to run: npm ${args.join(" ")}`);
    console.error(result.error.message);
    process.exit(1);
  }

  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function captureNpm(args) {
  const result = spawnSync(npmCommand, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);

  if (a.major !== b.major) {
    return a.major - b.major;
  }

  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }

  return a.patch - b.patch;
}

function nextPatchVersion(version) {
  const parsed = parseVersion(version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function getPublishedVersion(packageName) {
  const output = captureNpm(["view", packageName, "version", "--json"]);

  if (!output) {
    return null;
  }

  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function assertNpmLogin() {
  const currentUser = captureNpm(["whoami"]);

  if (currentUser) {
    console.log(`npm authenticated as ${currentUser}.`);
    return;
  }

  console.log("npm is not authenticated. Starting npm login...");
  runNpm(["login"]);

  const loggedInUser = captureNpm(["whoami"]);

  if (!loggedInUser) {
    console.error("npm login did not complete successfully.");
    process.exit(1);
  }

  console.log(`npm authenticated as ${loggedInUser}.`);
}

const packageJson = readPackageJson();
console.log(`Preparing release for ${packageJson.name}@${packageJson.version}.`);
assertNpmLogin();

const publishedVersion = getPublishedVersion(packageJson.name);
const baseVersion =
  publishedVersion && compareVersions(publishedVersion, packageJson.version) > 0
    ? publishedVersion
    : packageJson.version;
const nextVersion = nextPatchVersion(baseVersion);

console.log(`Next npm version: ${packageJson.name}@${nextVersion}.`);

runNpm(["run", "typecheck"]);
runNpm(["run", "build"]);
runNpm(["test"]);
runNpm(["version", nextVersion, "--no-git-tag-version"]);

console.log(`Publishing ${packageJson.name}@${nextVersion} to npm...`);
const publishResult = runNpm(["publish", "--ignore-scripts"], {
  allowFailure: true,
});

if (publishResult.status !== 0) {
  console.error(
    `Publish failed after bumping to ${nextVersion}. Fix the issue, then retry with: npm publish --ignore-scripts`,
  );
  process.exit(publishResult.status ?? 1);
}

console.log(`Published ${packageJson.name}@${nextVersion}.`);
