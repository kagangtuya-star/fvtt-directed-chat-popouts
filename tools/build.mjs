import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { check, root } from "./check.mjs";

// A deterministic, uncompressed ZIP using only Node's standard library.
// No package installation, external archiver or network access is needed.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function list(directory) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await list(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [file, data] of entries) {
    const name = Buffer.from(file, "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); // UTF-8 filenames
    header.writeUInt16LE(33, 12); // 1980-01-01, reproducible timestamp
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const manifest = await check();
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.RELEASE_TAG;
if (tag) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !/^v?\d+\.\d+\.\d+$/.test(tag ?? "")) {
    throw new Error("GITHUB_REPOSITORY and RELEASE_TAG must both be valid release values");
  }
  if (tag.replace(/^v/, "") !== manifest.version) throw new Error("Release tag does not match module version");
  manifest.url = `https://github.com/${repository}`;
  manifest.manifest = `${manifest.url}/releases/latest/download/module.json`;
  manifest.download = `${manifest.url}/releases/download/${tag}/directed-chat-popouts.zip`;
}
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const files = ["LICENSE", "README.md", "module.json", ...await list("scripts"), ...await list("styles"), ...await list("languages"), ...await list("docs")]
  .filter(file => file !== "scripts/lib/lib.js").sort();
const entries = await Promise.all(files.map(async file => [file, file === "module.json" ? manifestBytes : await readFile(path.join(root, file))]));
const archive = zip(entries);
await mkdir(path.join(root, "dist"), { recursive: true });
await writeFile(path.join(root, "dist/module.json"), manifestBytes);
await writeFile(path.join(root, "dist/directed-chat-popouts.zip"), archive);
await writeFile(path.join(root, "dist/SHA256SUMS"), `${createHash("sha256").update(archive).digest("hex")}  directed-chat-popouts.zip\n${createHash("sha256").update(manifestBytes).digest("hex")}  module.json\n`);
console.log(`Built dist/directed-chat-popouts.zip (${archive.length} bytes, ${files.length} files), module.json and SHA256SUMS.`);
