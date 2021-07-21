import * as fs from "fs/promises";

import semver from "semver";
import NpmApi from "npm-api";

import { LICENSE } from "./license.js";
import { createREADME } from "./readme.js";

const versionMap = new Map();

async function latestVersion(name, majorVersion, tag, useNpm = false) {
  const versions = versionMap.get(name);

  if (!versions && useNpm) {
    try {
      const pkgVersion = majorVersion.split('.')[0];
      const pkg = await getCurrentPackage(`${prefix}/${name.toLowerCase()}${pkgVersion}`, tag);
      console.error(`No versions for ${name} (${prefix}/${name.toLowerCase()}${pkgVersion}), checking npm...`);

      if (pkg) {
        console.error(`Found version: ${pkg.version} from npm.`);
        return pkg.version;
      } else {
        console.error(`No version on npm found for ${prefix}/${name.toLowerCase()}${pkgVersion}...`);
      }
    } catch (error) {
      console.error(`Error occurred looking up ${prefix}/${name.toLowerCase()}${pkgVersion} on NPM...`);
      console.error(error);
    }

    return null;
  }

  return versions[majorVersion];
}

function packageVersion(meta, revision) {
  const rawVersion = meta.package_version || meta.api_version;
  const sem = semver.parse(rawVersion) || semver.coerce(rawVersion);

  if (!sem) {
    throw new Error(`Invalid raw version: ${rawVersion} for ${meta.name}`);
  }

  sem.patch = revision;

  return `${sem.format()}`;
}

const prefix = "@gi-types";

const npm = new NpmApi();

async function getCurrentPackage(name, tag) {
  try {
    let repo = npm.repo(name);

    if (repo) {
      let pkg = await repo.version(tag);

      return pkg;
    }
  } catch (err) {
    console.log(err.message);
  }

  return null;
}

/**
 * @typedef PackageType
 * @property {string} path
 * @property {string} directory
 * @property {string} package
 * @property {string} gitHead
 * @property {string} version
 * @property {{name: string; api_version: string; package_version: string;}} meta
 */

/**
 * @param {*} meta
 * @param {string} version
 * @param {string} gitHead
 * @param {string} tag
 * @param {boolean} [hasOverride]
 * @param {boolean} [incrementVersions]
 */
async function buildPackageJSON(
  path,
  meta,
  version,
  gitHead,
  tag,
  incrementVersions = true,
  isPrivate = false
) {
  let semversion = semver.coerce(version);

  if (incrementVersions) {
    console.log(`${meta.name} has received a local patch upgrade, incrementing the version from npm by .1`);

    semversion.patch += 1;
  }

  let majorVersion = semversion.major;
  version = semversion.format();

  const [dependencies, peerDependencies] = (
    await Promise.all(
      Object.entries(meta.imports).map(async ([im, api_version]) => {
        const version = await latestVersion(im, api_version, tag, true);

        if (version) return [`${prefix}/${im.toLowerCase()}${api_version.split('.')[0]}`, `^${version}`];
        else return [`${prefix}/${im.toLowerCase()}`, `*`];
      })
    )
  )
    .reduce(
      ([dependencies, peerDependencies], [a, b]) => {
        if (b === "*") {
          peerDependencies.push([a, b]);
        } else {
          dependencies.push([a, b]);
        }

        return [dependencies, peerDependencies];
      },
      [[], []]
    )
    .map((list) =>
      list.length > 0 ? Object.fromEntries(list.sort(([a], [b]) => a.localeCompare(b))) : null
    );

  if (peerDependencies && Object.keys(peerDependencies).length > 0) {
    throw new Error(`${meta.name} has missing dependencies: ${Object.keys(peerDependencies).join(",")}.`);
  }

  return {
    name: `${prefix}/${meta.name.toLowerCase()}${majorVersion}`,
    ...(isPrivate
      ? { private: true }
      : {
          publishConfig: {
            access: "public",
            tag: tag,
          },
        }),
    version: `${version}`,
    description: `TypeScript definitions for ${meta.name}`,
    license: "MIT",
    contributors: [
      {
        name: "Evan Welsh",
        url: "https://github.com/ewlsh/",
        githubUsername: "ewlsh",
      },
    ],
    main: "",
    files: ["index.d.ts", "doc.json", "package.json", "README.md", "LICENSE"],
    types: "index.d.ts",
    repository: {
      type: "git",
      url: `https://github.com/${path}`,
      directory: `packages/@gi-types/${meta.slug}`,
    },
    scripts: {},
    ...(dependencies
      ? {
          dependencies: {
            ...dependencies,
          },
        }
      : {}),
    ...(peerDependencies
      ? {
          peerDependencies: {
            ...peerDependencies,
          },
        }
      : {}),
    typeScriptVersion: "4.1",
    gitHead: gitHead,
  };
}

/**
 * @param {string} dir
 */
async function getDirectories(dir) {
  return (
    await fs.readdir(dir, {
      withFileTypes: true,
    })
  )
    .filter((child) => child.isDirectory())
    .map((child) => child.name);
}

/**
 * @param {string} directory
 * @param {boolean} incrementVersions
 * @returns {Promise<PackageType[]>}
 */
async function generatePackages(directory, groupPath, incrementVersions) {
  console.log(`Generating packages for ${directory} and prefix ${groupPath}.`);

  const packages = await getDirectories(directory);

  return Promise.all(
    packages.map(async (packageName) => {
      const meta = JSON.parse(
        await fs.readFile(`${directory}/${packageName}/doc.json`, {
          encoding: "utf-8",
        })
      );

      let currentPackageVersion = null;
      let gitHead = null;

      let version = packageVersion(meta, 0);

      try {
        let packagejson = JSON.parse(
          await fs.readFile(`${directory}/${packageName}/package.json`, {
            encoding: "utf-8",
          })
        );

        currentPackageVersion = packagejson["version"];
        gitHead = packagejson["gitHead"];

        if (currentPackageVersion) {
          const sem = semver.parse(currentPackageVersion);
          version = packageVersion(meta, sem.patch);
        }
      } catch (err) {}

      meta.slug = packageName;

      const versions = versionMap.get(meta.name) || {};

      versions[meta.api_version] = version;

      versionMap.set(meta.name, versions);

      return {
        path: `gi-ts/${groupPath}`,
        isPrivate: false,
        directory,
        package: packageName,
        gitHead,
        version,
        meta,
      };
    })
  );
}

/**
 * @param {PackageType[]} packages
 * @param {string} tag
 */
function printPackages(packages, tag, incrementVersions) {
  return Promise.allSettled(
    packages.map(async ({ path, directory, package: packageName, gitHead, version, meta }) => {
      const json = await buildPackageJSON(path, meta, version, gitHead, tag, incrementVersions);

      const README = createREADME(meta.name, meta.api_version, meta.package_version);

      fs.writeFile(`${directory}/${packageName}/package.json`, `${JSON.stringify(json, null, 4)}\n`);

      fs.writeFile(`${directory}/${packageName}/LICENSE`, `${LICENSE}`);
      fs.writeFile(`${directory}/${packageName}/README.md`, `${README}`);
    })
  );
}

/**
 * @param {string} path
 * @param {boolean} incrementVersions
 */
export async function buildPackages(path, tag, incrementVersions) {
  const base = await generatePackages(`../${path}/packages/${prefix}/`, path, incrementVersions);

  await printPackages(base, tag, incrementVersions).then((results) => {
    const success = results.map((result) => result.status === "fulfilled");
    const failures = results
      .filter(
        /**
         *
         * @param {PromiseSettledResult<void>} result
         * @returns {result is PromiseRejectedResult}
         */
        (result) => result.status === "rejected"
      )
      .map((result) => result.reason);

    console.log(`Successfully generated ${success.length} packages, ${failures.length} packages failed.`);
    console.log(`Failures:`);
    console.log(failures.join("\n"));
    console.log(`Versions:`);
    console.log(versionMap);
  });
}

const path = process.argv[2];
const increment = process.argv[3] !== "--no-increment";
console.log(`Starting builder for ../${path}/packages/${prefix}/`);

buildPackages(path, "latest", increment)
  .then(() => {
    console.log("Packages built...");
  })
  .catch((error) => {
    console.log(error);
  });
