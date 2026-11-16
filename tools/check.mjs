import { readdir, readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const readJSON = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));

async function sources(directory) {
  const files = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sources(name));
    else if (/\.(?:m?js)$/.test(name)) files.push(name);
  }
  return files;
}

export async function check() {
  const manifest = await readJSON("module.json");
  const pkg = await readJSON("package.json");
  assert.equal(manifest.id, "directed-chat-popouts");
  assert.equal(manifest.title, "Directed Chat Popouts");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.deepEqual(manifest.compatibility, { minimum: "13", maximum: "14" });
  assert.equal(manifest.socket, undefined, "No unauthenticated module socket channel");
  for (const key of ["url", "manifest", "download"]) {
    const url = new URL(manifest[key]);
    assert.equal(url.protocol, "https:");
    assert(!/[{}#]/.test(url.href), "Unresolved release placeholder");
  }
  const paths = [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(lang => lang.path), manifest.license, manifest.readme];
  for (const file of paths) {
    assert(!path.isAbsolute(file) && !file.includes(".."));
    await access(path.join(root, file));
  }
  const en = (await readJSON("languages/en.json")).DCP;
  const zh = (await readJSON("languages/zh-cn.json")).DCP;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof en[key], "string");
    assert.equal(typeof zh[key], "string");
    const params = text => (text.match(/\{\w+\}/g) ?? []).sort();
    assert.deepEqual(params(en[key]), params(zh[key]));
  }
  const files = (await Promise.all(["scripts", "tools", "tests"].map(sources))).flat();
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    const source = await readFile(path.join(root, file), "utf8");
    assert(!/[^\S\r\n]+$/m.test(source), `${file}: trailing whitespace`);
    if (file.startsWith("scripts/")) {
      for (const [, key] of source.matchAll(/(?:localize\("|DCP\.)([A-Z]\w+)/g)) {
        assert(key in en, `${file}: missing translation ${key}`);
      }
    }
  }
  console.log(`Checked ${files.length} JavaScript files, manifest, package paths and ${Object.keys(en).length} bilingual strings.`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await check();
