#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalBytes, sha256 } from "./lib/canonical-json.mjs";
import {
  ARTIFACTS,
  ARTIFACT_SPEC,
  CONTRACT_REPOSITORIES,
  CURRENT_CONTRACT_REPOSITORY,
  loadBundle,
  validateBundle,
} from "./lib/contract-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function canonicalizeProvenanceSchema() {
  const schemaPath = path.join(root, "runa-sdk-contract.provenance.schema.json");
  const schemaTemporary = `${schemaPath}.next`;
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  await writeFile(schemaTemporary, canonicalBytes(schema), { flag: "wx" });
  await rename(schemaTemporary, schemaPath);
}
async function updateSourceManifest() {
  const manifestPath = path.join(root, "source-artifacts.manifest.json");
  const manifestTemporary = `${manifestPath}.next`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const sources = await Promise.all(manifest.sources.map(async (source) => ({
    ...source,
    sha256: sha256(await readFile(path.resolve(root, source.path))),
  })));
  await writeFile(
    manifestTemporary,
    canonicalBytes({ ...manifest, sources }),
    { flag: "wx" },
  );
  await rename(manifestTemporary, manifestPath);
}
async function writeArtifactManifest() {
  const artifacts = [];
  for (const artifactPath of ARTIFACTS) {
    const bytes = await readFile(path.join(root, artifactPath));
    const [mediaType, role] = ARTIFACT_SPEC[artifactPath];
    artifacts.push({ bytes: bytes.length, mediaType, path: artifactPath, role, sha256: sha256(bytes) });
  }
  const manifestPath = path.join(root, "artifact-manifest.json");
  const manifestTemporary = `${manifestPath}.next`;
  await writeFile(manifestTemporary, canonicalBytes({ artifacts, hashAlgorithm: "sha256", schemaVersion: 3 }), { flag: "wx" });
  await rename(manifestTemporary, manifestPath);
}
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const canonicalRef = argument("--canonical-ref");
const sourceRevision = argument("--source-revision") ?? canonicalRef;
const contractPrUrl = argument("--contract-pr-url");
const contractMergeSha = argument("--contract-merge-sha");
const prd002PrUrl = argument("--prd002-pr-url");
const prd002MergeSha = argument("--prd002-merge-sha");
const commit = /^[a-f0-9]{40}$/u;
const pullRequestRepository = (value) => {
  const match = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/[1-9][0-9]*$/u.exec(value ?? "");
  return match?.[1];
};
if (process.argv.includes("--refresh-blocked")) {
  const provenancePath = path.join(root, "runa-sdk-contract.provenance.json");
  const provenanceTemporary = `${provenancePath}.next`;
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  const snapshotBytes = await readFile(path.join(root, "runa-sdk-contract.snapshot.json"));
  const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
  const refreshed = {
    ...provenance,
    accepted_baseline_sha256: sha256(await readFile(path.join(root, "sources/PRD-002-rest-contract-baseline.md"))),
    approval_reference: null,
    artifacts: {
      baseline_expectation_manifest: {
        path: "runa-sdk-contract.prd002-expected-manifest.json",
        sha256: sha256(await readFile(path.join(root, "runa-sdk-contract.prd002-expected-manifest.json"))),
      },
      contract_projection: {
        path: "runa-sdk-contract.prd002-projection.json",
        sha256: sha256(await readFile(path.join(root, "runa-sdk-contract.prd002-projection.json"))),
      },
      snapshot: { path: "runa-sdk-contract.snapshot.json", sha256: sha256(snapshotBytes) },
      snapshot_schema: {
        path: "runa-sdk-contract.snapshot.schema.json",
        sha256: sha256(await readFile(path.join(root, "runa-sdk-contract.snapshot.schema.json"))),
      },
    },
    baseline_extractor_identity: {
      ...provenance.baseline_extractor_identity,
      git_commit_sha: null,
      sha256: sha256(await readFile(path.join(root, "tools/extract-prd002-expectations.mjs"))),
    },
    canonical_ref: null,
    canonical_repository: CURRENT_CONTRACT_REPOSITORY,
    generator_identity: {
      ...provenance.generator_identity,
      git_commit_sha: null,
      sha256: sha256(await readFile(path.join(root, "tools/runa-contract-generator.mjs"))),
      version: snapshot.generator_configuration.generator_version,
    },
    reason: `OpenAPI ${snapshot.snapshot_version} additive AgentAuth and workspace authority contract awaits immutable reviewed approval.`,
    semantic_change_class: "additive",
    snapshot_version: snapshot.snapshot_version,
    source_revision: null,
    status: "BLOCKED",
  };
  await writeFile(provenanceTemporary, canonicalBytes(refreshed), { flag: "wx" });
  await rename(provenanceTemporary, provenancePath);
  await canonicalizeProvenanceSchema();
  const blockedBundle = await loadBundle(root);
  validateBundle(blockedBundle);
  if (blockedBundle.provenance.status !== "BLOCKED") {
    throw new Error("R-003-15: blocked artifact refresh requires BLOCKED provenance.");
  }
  await updateSourceManifest();
  await writeArtifactManifest();
  console.log("blocked provenance preserved; artifact manifest regenerated");
  process.exit(0);
}
if (!commit.test(canonicalRef ?? "") || !commit.test(sourceRevision ?? "") ||
    !commit.test(contractMergeSha ?? "") || !commit.test(prd002MergeSha ?? "") ||
    !CONTRACT_REPOSITORIES.includes(pullRequestRepository(contractPrUrl)) ||
    !CONTRACT_REPOSITORIES.includes(pullRequestRepository(prd002PrUrl))) {
  throw new Error("R-003-15: immutable 40-hex revisions and GitHub pull-request URLs are required.");
}
const bundle = await loadBundle(root);
validateBundle(bundle);
if (bundle.provenance.status !== "BLOCKED") throw new Error("R-003-15: provenance is not in BLOCKED state.");
if (pullRequestRepository(contractPrUrl) !== bundle.provenance.canonical_repository ||
    pullRequestRepository(prd002PrUrl) !== bundle.provenance.canonical_repository) {
  throw new Error("R-003-15: approval pull requests must belong to the canonical contract repository.");
}
const approved = {
  ...bundle.provenance,
  approval_reference: {
    contract_merge_commit_sha: contractMergeSha,
    contract_pull_request_url: contractPrUrl,
    prd002_merge_commit_sha: prd002MergeSha,
    prd002_pull_request_url: prd002PrUrl,
  },
  baseline_extractor_identity: { ...bundle.provenance.baseline_extractor_identity, git_commit_sha: canonicalRef },
  canonical_ref: canonicalRef,
  generator_identity: { ...bundle.provenance.generator_identity, git_commit_sha: canonicalRef },
  reason: null,
  source_revision: sourceRevision,
  status: "APPROVED",
};
validateBundle({ ...bundle, provenance: approved });
const approvedBytes = canonicalBytes(approved);
if (process.argv.includes("--dry-run")) {
  process.stdout.write(approvedBytes);
} else {
  const provenancePath = path.join(root, "runa-sdk-contract.provenance.json");
  const provenanceTemporary = `${provenancePath}.next`;
  await writeFile(provenanceTemporary, approvedBytes, { flag: "wx" });
  await rename(provenanceTemporary, provenancePath);
  await updateSourceManifest();
  await writeArtifactManifest();
  console.log("provenance transition: APPROVED; artifact manifest regenerated");
}
