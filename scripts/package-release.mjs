import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CRC32_TABLE = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  CRC32_TABLE[index] = value >>> 0;
}

const ZIP_VERSION = 20;
const ZIP_STORE_METHOD = 0;
const FILE_MODE = 0o100644;
const FIXED_DATE = new Date("1980-01-01T00:00:00Z");

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const distDir = path.join(repoRoot, "dist");
  const releasesDir = path.join(repoRoot, "releases");

  await assertDirectoryExists(distDir);

  const packageJsonPath = path.join(repoRoot, "package.json");
  const manifestPath = path.join(repoRoot, "src", "manifest.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  const requestedVersion = getRequestedVersion(process.argv.slice(2));
  const resolvedVersion = normalizeVersionTag(
    requestedVersion ?? manifest.version ?? packageJson.version,
  );

  if (!resolvedVersion) {
    throw new Error("Unable to resolve a release version from arguments, manifest, or package.json.");
  }

  const archiveName = `${packageJson.name}-${resolvedVersion}.zip`;
  const archivePath = path.join(releasesDir, archiveName);
  const entries = await collectFiles(distDir);

  if (entries.length === 0) {
    throw new Error("Cannot package an empty dist/ directory.");
  }

  const archiveBuffer = await buildZip(entries);

  await mkdir(releasesDir, { recursive: true });
  await writeFile(archivePath, archiveBuffer);

  process.stdout.write(`${toPosixPath(path.relative(repoRoot, archivePath))}\n`);
}

async function assertDirectoryExists(directoryPath) {
  let directoryStats;

  try {
    directoryStats = await stat(directoryPath);
  } catch {
    throw new Error(`Build output not found: ${directoryPath}. Run \"pnpm build\" first.`);
  }

  if (!directoryStats.isDirectory()) {
    throw new Error(`Expected a directory at ${directoryPath}.`);
  }
}

function getRequestedVersion(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument) {
      continue;
    }

    if (argument === "--version" || argument === "-v") {
      return args[index + 1] ?? null;
    }

    if (argument.startsWith("--version=")) {
      return argument.slice("--version=".length);
    }

    if (!argument.startsWith("-")) {
      return argument;
    }
  }

  return null;
}

function normalizeVersionTag(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  return trimmedValue.startsWith("v") ? trimmedValue : `v${trimmedValue}`;
}

async function collectFiles(rootDirectory, currentDirectory = rootDirectory) {
  const directoryEntries = await readdir(currentDirectory, { withFileTypes: true });
  const files = [];

  directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of directoryEntries) {
    const absolutePath = path.join(currentDirectory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDirectory, absolutePath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push({
      absolutePath,
      relativePath: toPosixPath(path.relative(rootDirectory, absolutePath)),
    });
  }

  return files;
}

async function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.relativePath, "utf8");
    const data = await readFile(entry.absolutePath);
    const crc32 = calculateCrc32(data);
    const timestamp = toDosDateTime(FIXED_DATE);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((FILE_MODE << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function calculateCrc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date) {
  const year = Math.max(date.getUTCFullYear(), 1980);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
