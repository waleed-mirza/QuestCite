import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import packageJson from "../package.json";
import { auditReleaseInventory, filterReleaseFiles } from "../src/lib/security/release-inventory";

const root = process.cwd();
const FIXED_DOS_DATE = { date: 0x5c84, time: 0 };

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (0xedb88320 ^ (value >>> 1)) >>> 0 : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    const tableValue = crc32Table[(value ^ byte) & 0xff] ?? 0;
    value = ((value >>> 8) ^ tableValue) >>> 0;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function buildZip(files: Array<{ name: string; content: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(file.content.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, file.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(file.content.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(FIXED_DOS_DATE.date, 12);
    central.writeUInt16LE(FIXED_DOS_DATE.time, 10);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + file.content.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function safeArchiveName(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("RELEASE_PATH_INVALID");
  }
  return normalized;
}

function main(): number {
  const releaseFiles = filterReleaseFiles(trackedFiles());
  const violations = auditReleaseInventory(releaseFiles);
  if (violations.length > 0) {
    console.error("Release package blocked by inventory audit.");
    return 1;
  }

  const archiveFiles = releaseFiles.map((file) => {
    const name = safeArchiveName(file);
    return { name, content: readFileSync(path.resolve(root, name)) };
  });
  const archive = buildZip(archiveFiles);
  const outputDirectory = path.resolve("dist");
  const archivePath = path.join(outputDirectory, `questcite-${packageJson.version}.zip`);
  const checksumPath = `${archivePath}.sha256`;
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(archivePath, archive);
  const checksum = createHash("sha256").update(archive).digest("hex");
  writeFileSync(checksumPath, `${checksum}  ${path.basename(archivePath)}\n`);
  console.log(`Release package created: ${archiveFiles.length} files, ${archive.byteLength} bytes, SHA-256 sidecar written.`);
  return 0;
}

try {
  process.exitCode = main();
} catch {
  console.error("Release package failed.");
  process.exitCode = 1;
}
