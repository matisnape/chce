// js/shortcut.js is generated from js/extract.js, and the "chce" shortcut embeds it as a literal:
// these fail when any of them drift apart.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScript, buildPlist } from "../scripts/build-shortcut.mjs";

const root = new URL("..", import.meta.url).pathname;
const published = readFileSync(`${root}js/shortcut.js`, "utf8");

assert.equal(published, buildScript(), "js/shortcut.js is stale: run `node scripts/build-shortcut.mjs`");
const js = (kind) => buildPlist(kind).WFWorkflowActions.find((a) => a.WFWorkflowActionIdentifier.endsWith("runjavascriptonwebpage")).WFWorkflowActionParameters.WFJavaScript;
assert.equal(js("embedded"), published, "chce embeds a script that differs from js/shortcut.js");
assert.equal(typeof js("dev"), "object", "chce-dev must fetch the script, not embed it");
console.log("shortcut.js matches extract.js and the embedded literal");

// The signed files are what users import. Opening one needs Apple's `aea` (macOS only, not on CI).
const aea = process.platform === "darwin";
if (!aea) console.log("signed shortcut check skipped: no aea on this platform");
else {
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });
  const unwrap = (file) => {
    const dir = mkdtempSync(join(tmpdir(), "chce-sc-"));
    const hdr = readFileSync(file);
    writeFileSync(`${dir}/hdr.plist`, hdr.subarray(12, 12 + hdr.readUInt32LE(8)));
    writeFileSync(`${dir}/leaf.der`, Buffer.from(run("plutil", ["-extract", "SigningCertificateChain.0", "raw", "-o", "-", `${dir}/hdr.plist`]), "base64"));
    writeFileSync(`${dir}/pub.pem`, run("openssl", ["x509", "-inform", "der", "-in", `${dir}/leaf.der`, "-pubkey", "-noout"]));
    run("aea", ["decrypt", "-i", file, "-o", `${dir}/p.aar`, "-sign-pub", `${dir}/pub.pem`]);
    mkdirSync(`${dir}/x`);
    run("aa", ["extract", "-i", `${dir}/p.aar`, "-d", `${dir}/x`]);
    return { WFWorkflowActions: JSON.parse(run("plutil", ["-extract", "WFWorkflowActions", "json", "-o", "-", `${dir}/x/Shortcut.wflow`])) };
  };
  const jsOf = (plist) => plist.WFWorkflowActions.find((a) => a.WFWorkflowActionIdentifier.endsWith("runjavascriptonwebpage")).WFWorkflowActionParameters.WFJavaScript;
  const embedded = unwrap(`${root}chce.shortcut`);
  assert.equal(jsOf(embedded), published, "chce.shortcut is stale: rebuild and re-sign it (see README)");
  assert.equal(embedded.WFWorkflowActions.length, 2);
  const dev = unwrap(`${root}chce-dev.shortcut`);
  assert.deepEqual(dev.WFWorkflowActions.map((a) => a.WFWorkflowActionIdentifier.replace("is.workflow.actions.", "")),
    ["downloadurl", "detect.text", "runjavascriptonwebpage", "openurl"], "chce-dev.shortcut is stale");
  console.log("signed shortcuts match the build");
}
