#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalBytes, canonicalJson } from "./lib/canonical-json.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
const openapi = await readJson("runa-api.openapi.json");
const expected = await readJson("runa-sdk-contract.prd002-expected-manifest.json");
const resolve = (value) => {
  if (value?.$ref === undefined) return value;
  let current = openapi;
  for (const token of value.$ref.slice(2).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) current = current[token];
  return current;
};
const operationsByKey = new Map();
for (const [pathTemplate, pathItem] of Object.entries(openapi.paths)) {
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    const operation = pathItem[method];
    if (operation?.["x-sdk-exposed"] === true) {
      operationsByKey.set(operation.operationId, { method: method.toUpperCase(), operation, pathTemplate });
    }
  }
}

const fact = (identity) => {
  const found = expected.facts.find((item) => item.identity === identity);
  if (found === undefined) throw new Error(`R-003-14: missing independent fact ${identity}`);
  return found;
};
const questionSource = Object.fromEntries(expected.questions.map((item) => [item.id, item.source_ref]));
const unresolvedFor = (key) => {
  const ids = new Set(["OQ-002-10", "OQ-002-11"]);
  if (new Set(["records.list", "sessions.list"]).has(key)) ids.add("OQ-002-06");
  if (key.startsWith("sessions.")) ids.add("OQ-002-07");
  if (key === "sessions.exec") ids.add("OQ-002-08");
  if (key === "sessions.open") ids.add("OQ-002-09");
  return [...ids].sort().map((questionId) => ({
    evidence_state: "unresolved", question_id: questionId, source_ref: questionSource[questionId],
  }));
};
const schemaSource = {
  AgentAuth: "PRD-002#6.3", AgentSession: "PRD-002#6.6", AgentSessionCreate: "PRD-002#6.6",
  AgentSessionPage: "PRD-002#6.6", AgentSessionRename: "PRD-002#6.6", Capability: "PRD-002#6.8",
  CapabilitySnapshot: "PRD-002#6.8", CheckpointRequest: "PRD-002#6.1.1", Error: "PRD-002#6.9",
  ExecRequest: "PRD-002#6.1.1", ExecResult: "PRD-002#6.1.1", MachineCreateRequest: "PRD-002#6.7",
  Me: "PRD-002#6.4", Ok: "PRD-002#6.1.1", OpenResult: "PRD-002#6.5",
  OutboundPolicy: "PRD-002#6.1.1", Problem: "PRD-002#6.9", Record: "PRD-002#6.9",
  RuntimeUrl: "PRD-002#6.5", SdkCreateSession: "PRD-002#6.1.1",
  Session: "PRD-002#6.2", TerminalConnectionCapability: "PRD-002#6.6",
  TerminalConnectionCreate: "PRD-002#6.6", TerminalConnectionGrant: "PRD-002#6.6", Uuid: "PRD-002#6.2",
  WorkspaceBinding: "PRD-002#6.7", WorkspaceBindingCreate: "PRD-002#6.7",
  WorkspaceSyncBegin: "PRD-002#6.7", WorkspaceSyncChangeEnvelope: "PRD-002#6.7",
  WorkspaceSyncChangeItem: "PRD-002#6.7", WorkspaceSyncChangePage: "PRD-002#6.7",
  WorkspaceSyncChunkEnvelope: "PRD-002#6.7", WorkspaceSyncChunkReceipt: "PRD-002#6.7",
  WorkspaceSyncChunkRef: "PRD-002#6.7", WorkspaceSyncCommit: "PRD-002#6.7",
  WorkspaceSyncCommitEnvelope: "PRD-002#6.7", WorkspaceSyncCommitReceipt: "PRD-002#6.7",
  WorkspaceSyncManifestEntry: "PRD-002#6.7", WorkspaceSyncManifestEnvelope: "PRD-002#6.7",
  WorkspaceSyncManifestPage: "PRD-002#6.7", WorkspaceSyncManifestReceipt: "PRD-002#6.7",
  WorkspaceSyncProblem: "PRD-002#6.7", WorkspaceSyncProtocolRange: "PRD-002#6.7",
  WorkspaceSyncReconcile: "PRD-002#6.7", WorkspaceSyncReconcileEnvelope: "PRD-002#6.7",
  WorkspaceSyncReconcileReceipt: "PRD-002#6.7", WorkspaceSyncSession: "PRD-002#6.7",
  WorkspaceSyncSessionEnvelope: "PRD-002#6.7",
};
const expectedOperationKeys = new Set(expected.facts
  .filter((item) => item.identity.startsWith("operation:") && item.identity.endsWith(":method"))
  .map((item) => item.identity.slice("operation:".length, -":method".length)));
const operationKeys = [...operationsByKey.keys()]
  .filter((operationKey) => expectedOperationKeys.has(operationKey)).sort();
const descriptors = operationKeys.map((operationKey) => {
  const { method, operation, pathTemplate } = operationsByKey.get(operationKey);
  const statuses = Object.keys(operation.responses).filter((status) => status !== "default");
  const successStatus = Number(statuses[0]);
  const jsonRequestSchema = operation["x-sdk-request-schema"] ??
    operation.requestBody?.content?.["application/json; charset=utf-8"]?.schema ?? null;
  const binaryRequestSchema = operation.requestBody?.content?.["application/octet-stream"]?.schema ?? null;
  const requestSchema = jsonRequestSchema ?? binaryRequestSchema;
  const binaryRequest = binaryRequestSchema !== null;
  const responseSchema = resolve(operation.responses[String(successStatus)]).content["application/json"].schema;
  const errorSchema = resolve(operation.responses.default).content["application/json"].schema;
  const ids = ["method", "path-template", "path-parameters", "request-shape", "success-shape", "success-status"]
    .map((suffix) => `operation:${operationKey}:${suffix}`);
  return {
    error_facts: {
      encoding: "utf-8", evidence_state: "documented", media_type: "application/json",
      known_limit_statuses: [409, 422], schema: errorSchema, source_ref: "PRD-002#6.9",
    },
    http_binding: {
      accept: "application/json", authorization_scheme: "Bearer", content_type_with_body: binaryRequest ? "application/octet-stream" : "application/json; charset=utf-8",
      follow_redirects: false, max_response_bytes: 8_388_608,
      response_encoding: "utf-8", response_media_type: "application/json",
      source_ref: "PRD-002#6.1.1",
    },
    method,
    operation_key: operationKey,
    path_parameters: [...pathTemplate.matchAll(/\{([^}]+)\}/gu)].map((match) => ({
      name: match[1], renderer: { case_fold: false, format: match[1] === "digest" ? "sha256" : "uuid", pattern: match[1] === "digest" ? "^[0-9a-f]{64}$" : "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", percent_encode: false, segment_count: 1, substitution: "unchanged", trim: false, type: "string", unicode_normalize: false },
      source_ref: "PRD-002#6.1.1",
    })),
    path_template: fact(`operation:${operationKey}:path-template`).value,
    request: requestSchema === null ? {
      body_bytes: "none", body_presence: "absent", content_type_rule: "omit", encoding: null, media_type: null, schema: null,
      source_ref: fact(`operation:${operationKey}:request-shape`).source_ref, source_shape: fact(`operation:${operationKey}:request-shape`).value,
    } : binaryRequest ? {
      body_bytes: "binary", body_presence: "required", content_type_rule: "send", encoding: null, media_type: "application/octet-stream",
      schema: requestSchema, source_ref: "PRD-002#6.1.1",
      source_shape: fact(`operation:${operationKey}:request-shape`).value,
    } : {
      body_bytes: "one-json-value", body_presence: "required", content_type_rule: "send", encoding: "utf-8", media_type: "application/json; charset=utf-8",
      schema: requestSchema, source_ref: "PRD-002#6.1.1",
      source_shape: fact(`operation:${operationKey}:request-shape`).value,
    },
    source_refs: [...new Set(ids.map((identity) => fact(identity).source_ref).concat(["PRD-002#6.1.1"]))].sort(),
    success: {
      encoding: "utf-8", media_type: "application/json", schema: responseSchema,
      selector: { kind: "exact", status: successStatus }, source_ref: fact(`operation:${operationKey}:success-shape`).source_ref,
      source_shape: fact(`operation:${operationKey}:success-shape`).value,
    },
    unresolved_refs: unresolvedFor(operationKey),
  };
});

const sourceReferenceMap = expected.facts.map(({ identity, source_ref }) => ({ identity, source_ref }))
  .concat(Object.entries(schemaSource).map(([name, source_ref]) => ({ identity: `component:${name}`, source_ref })))
  .sort((left, right) => left.identity.localeCompare(right.identity));
const unresolvedQuestionMap = expected.questions.filter((item) => item.evidence_state === "unresolved")
  .map((item) => ({ evidence_state: "unresolved", question_id: item.id, source_ref: item.source_ref }))
  .sort((left, right) => left.question_id.localeCompare(right.question_id));
const schemas = Object.fromEntries(Object.keys(schemaSource).sort().map((name) => {
  const schema = openapi.components.schemas[name];
  if (schema === undefined) throw new Error(`R-003-28: missing component ${name}`);
  return [name, schema];
}));
const snapshot = {
  components: { schemas, source_refs: Object.entries(schemaSource).sort(([a], [b]) => a.localeCompare(b))
    .map(([component, source_ref]) => ({ component, source_ref })) },
  contract_id: "runa-sdk-contract",
  generator_configuration: {
    configuration_version: "1.0.0", generator_version: "0.2.0",
    generated_roots: {
      python: "src/runa/_internal/contract/generated/",
      typescript: "src/internal/contract/generated/",
    },
    languages: ["python", "typescript"],
  },
  operations: descriptors,
  question_map: expected.questions,
  schema_version: 1,
  snapshot_version: "1.7.0",
  source_reference_map: sourceReferenceMap,
  unresolved_question_map: unresolvedQuestionMap,
};

const projectedFact = (identity, value) => ({ identity, source_ref: fact(identity).source_ref, value });
const projectionFacts = descriptors.flatMap((operation) => [
  projectedFact(`operation:${operation.operation_key}:method`, operation.method),
  projectedFact(`operation:${operation.operation_key}:path-template`, operation.path_template),
  projectedFact(`operation:${operation.operation_key}:path-parameters`, operation.path_parameters.map((item) => item.name)),
  projectedFact(`operation:${operation.operation_key}:request-shape`, operation.request.source_shape),
  projectedFact(`operation:${operation.operation_key}:success-shape`, operation.success.source_shape),
  projectedFact(`operation:${operation.operation_key}:success-status`, operation.success.selector.status),
]).concat([
  { identity: "wire:follow-redirects", source_ref: "PRD-002#6.1.1", value: false },
  { identity: "wire:max-response-bytes", source_ref: "PRD-002#6.1.1", value: 8_388_608 },
  { identity: "wire:request-accept", source_ref: "PRD-002#6.1.1", value: "application/json" },
  { identity: "wire:request-content-type", source_ref: "PRD-002#6.1.1", value: "application/json; charset=utf-8" },
  { identity: "wire:response-encoding", source_ref: "PRD-002#6.1.1", value: "utf-8" },
  { identity: "wire:response-media-type", source_ref: "PRD-002#6.1.1", value: "application/json" },
]).sort((left, right) => left.identity.localeCompare(right.identity));
const projection = {
  accepted_baseline: expected.accepted_baseline,
  facts: projectionFacts,
  questions: snapshot.question_map,
  schema_version: 1,
};

const sdkProjectionOperations = Object.fromEntries(
  [...operationsByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([operationKey, { method, operation, pathTemplate }]) => {
      const successStatus = Number(
        Object.keys(operation.responses).find((status) => status !== "default"),
      );
      return [operationKey, {
        method,
        path: pathTemplate,
        requestBody:
          operation["x-sdk-request-schema"] ??
          operation.requestBody?.content?.["application/json; charset=utf-8"]?.schema ??
          null,
        response: operation.responses[String(successStatus)],
        successStatus,
      }];
    }),
);
const sdkProjectionSchemaNames = new Set([
  "AgentSession",
  "AgentSessionCreate",
  "AgentSessionPage",
  "AgentSessionRename",
  "Capability",
  "CapabilitySnapshot",
  "CheckpointRequest",
  "Error",
  "ExecRequest",
  "ExecResult",
  "Me",
  "Ok",
  "OpenResult",
  "OutboundPolicy",
  "Problem",
  "Record",
  "RuntimeUrl",
  "SdkCreateSession",
  "Session",
  "TerminalConnectionCapability",
  "TerminalConnectionCreate",
  "TerminalConnectionGrant",
  "Uuid",
  "WorkspaceSyncProblem",
  "WorkspaceSyncBegin",
  "WorkspaceSyncManifestPage",
  "WorkspaceSyncCommit",
  "WorkspaceSyncReconcile",
  "WorkspaceSyncSessionEnvelope",
  "WorkspaceSyncManifestEnvelope",
  "WorkspaceSyncChunkEnvelope",
  "WorkspaceSyncCommitEnvelope",
  "WorkspaceSyncChangeEnvelope",
  "WorkspaceSyncReconcileEnvelope",
  "MachineCreateRequest",
]);
const pendingSdkProjectionSchemas = [...sdkProjectionSchemaNames];
function collectSdkProjectionSchemaReferences(value) {
  if (Array.isArray(value)) {
    for (const item of value) collectSdkProjectionSchemaReferences(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (typeof value.$ref === "string") {
    const match = /^#\/components\/schemas\/([A-Za-z][A-Za-z0-9]*)$/u.exec(value.$ref);
    if (match) {
      const name = match[1];
      if (!sdkProjectionSchemaNames.has(name)) {
        sdkProjectionSchemaNames.add(name);
        pendingSdkProjectionSchemas.push(name);
      }
    } else if (value.$ref.startsWith("#/components/schemas/")) {
      throw new Error(`R-003-12: invalid SDK projection schema reference ${value.$ref}`);
    }
  }
  for (const item of Object.values(value)) collectSdkProjectionSchemaReferences(item);
}
collectSdkProjectionSchemaReferences(sdkProjectionOperations);
for (let index = 0; index < pendingSdkProjectionSchemas.length; index += 1) {
  const name = pendingSdkProjectionSchemas[index];
  const component = openapi.components.schemas[name];
  if (component === undefined) throw new Error(`R-003-12: missing SDK projection schema ${name}`);
  collectSdkProjectionSchemaReferences(component);
}
const sdkProjectionSchemas = Object.fromEntries(
  [...sdkProjectionSchemaNames]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => [name, openapi.components.schemas[name]]),
);
collectSdkProjectionSchemaReferences(sdkProjectionSchemas);
for (const name of sdkProjectionSchemaNames) {
  if (!Object.hasOwn(sdkProjectionSchemas, name)) {
    throw new Error(`R-003-12: incomplete SDK projection schema closure ${name}`);
  }
}
const sdkProjection = {
  contractVersion: openapi.info.version,
  operations: sdkProjectionOperations,
  schemas: sdkProjectionSchemas,
  wire: openapi["x-runa-wire"],
};

const ref = (name) => ({ $ref: `#/$defs/${name}` });
const closed = (required, properties) => ({ additionalProperties: false, properties, required, type: "object" });
const schema = {
  $id: "https://schemas.runacode.io/sdk/runa-sdk-contract.snapshot.schema.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  "x-schema-format-version": 1,
  additionalProperties: false,
  properties: {
    components: ref("components"), contract_id: { const: "runa-sdk-contract" },
    generator_configuration: ref("generatorConfiguration"), operations: {
      items: ref("operation"), maxItems: 31, minItems: 31, type: "array",
    },
    schema_version: { const: 1 }, snapshot_version: { pattern: "^\\d+\\.\\d+\\.\\d+$", type: "string" },
    question_map: { items: ref("question"), minItems: 1, type: "array" },
    source_reference_map: { items: ref("sourceReference"), minItems: 1, type: "array" },
    unresolved_question_map: { items: ref("unresolved"), minItems: 1, type: "array" },
  },
  required: ["components", "contract_id", "generator_configuration", "operations", "question_map", "schema_version", "snapshot_version", "source_reference_map", "unresolved_question_map"],
  title: "Runa SDK binding-complete contract snapshot", type: "object",
  $defs: {
    components: closed(["schemas", "source_refs"], {
      schemas: closed(Object.keys(schemaSource).sort(), Object.fromEntries(Object.keys(schemaSource).sort().map((name) => [name, { type: "object" }]))),
      source_refs: { items: closed(["component", "source_ref"], { component: { type: "string" }, source_ref: { pattern: "^PRD-002#", type: "string" } }), type: "array" },
    }),
    errorFacts: closed(["encoding", "evidence_state", "known_limit_statuses", "media_type", "schema", "source_ref"], {
      encoding: { const: "utf-8" }, evidence_state: { enum: ["documented", "unresolved"] }, known_limit_statuses: { const: [409, 422] }, media_type: { const: "application/json" }, schema: { type: "object" }, source_ref: { pattern: "^PRD-002#", type: "string" },
    }),
    generatorConfiguration: closed(["configuration_version", "generated_roots", "generator_version", "languages"], {
      configuration_version: { type: "string" }, generated_roots: closed(["python", "typescript"], { python: { const: "src/runa/_internal/contract/generated/" }, typescript: { const: "src/internal/contract/generated/" } }),
      generator_version: { type: "string" }, languages: { const: ["python", "typescript"] },
    }),
    httpBinding: closed(["accept", "authorization_scheme", "content_type_with_body", "follow_redirects", "max_response_bytes", "response_encoding", "response_media_type", "source_ref"], {
      accept: { const: "application/json" }, authorization_scheme: { const: "Bearer" }, content_type_with_body: { enum: ["application/json; charset=utf-8", "application/octet-stream"] }, follow_redirects: { const: false }, max_response_bytes: { const: 8388608 }, response_encoding: { const: "utf-8" }, response_media_type: { const: "application/json" }, source_ref: { const: "PRD-002#6.1.1" },
    }),
    operation: closed(["error_facts", "http_binding", "method", "operation_key", "path_parameters", "path_template", "request", "source_refs", "success", "unresolved_refs"], {
      error_facts: ref("errorFacts"), http_binding: ref("httpBinding"), method: { enum: ["DELETE", "GET", "PATCH", "POST", "PUT"] }, operation_key: { enum: operationKeys },
      path_parameters: { items: ref("pathParameter"), type: "array" }, path_template: { pattern: "^/v1/", type: "string" }, request: ref("request"),
      source_refs: { items: { pattern: "^PRD-002#", type: "string" }, minItems: 1, type: "array" }, success: ref("success"),
      unresolved_refs: { items: ref("unresolved"), type: "array" },
    }),
    pathParameter: closed(["name", "renderer", "source_ref"], { name: { enum: ["binding_id", "digest", "id"] }, renderer: closed(["case_fold", "format", "pattern", "percent_encode", "segment_count", "substitution", "trim", "type", "unicode_normalize"], { case_fold: { const: false }, format: { enum: ["sha256", "uuid"] }, pattern: { enum: ["^[0-9a-f]{64}$", "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"] }, percent_encode: { const: false }, segment_count: { const: 1 }, substitution: { const: "unchanged" }, trim: { const: false }, type: { const: "string" }, unicode_normalize: { const: false } }), source_ref: { const: "PRD-002#6.1.1" } }),
    question: closed(["evidence_state", "id", "source_ref"], { evidence_state: { enum: ["resolved", "unresolved"] }, id: { pattern: "^OQ-002-", type: "string" }, source_ref: { pattern: "^PRD-002#11:OQ-002-", type: "string" } }),
    request: closed(["body_bytes", "body_presence", "content_type_rule", "encoding", "media_type", "schema", "source_ref", "source_shape"], { body_bytes: { enum: ["binary", "none", "one-json-value"] }, body_presence: { enum: ["absent", "required"] }, content_type_rule: { enum: ["omit", "send"] }, encoding: { type: ["string", "null"] }, media_type: { type: ["string", "null"] }, schema: { type: ["object", "null"] }, source_ref: { pattern: "^PRD-002#", type: "string" }, source_shape: { type: "string" } }),
    sourceReference: closed(["identity", "source_ref"], { identity: { type: "string" }, source_ref: { pattern: "^PRD-002#", type: "string" } }),
    success: closed(["encoding", "media_type", "schema", "selector", "source_ref", "source_shape"], { encoding: { const: "utf-8" }, media_type: { const: "application/json" }, schema: { type: "object" }, selector: closed(["kind", "status"], { kind: { const: "exact" }, status: { enum: [200, 201] } }), source_ref: { pattern: "^PRD-002#", type: "string" }, source_shape: { type: "string" } }),
    unresolved: closed(["evidence_state", "question_id", "source_ref"], { evidence_state: { const: "unresolved" }, question_id: { pattern: "^OQ-002-", type: "string" }, source_ref: { pattern: "^PRD-002#11:OQ-002-", type: "string" } }),
  },
};

const outputs = {
  "runa-sdk-contract.prd002-projection.json": projection,
  "runa-sdk-contract.snapshot.json": snapshot,
  "runa-sdk-contract.snapshot.schema.json": schema,
  "runa-sdk.projection.json": sdkProjection,
};
if (process.argv.includes("--write")) {
  for (const [name, value] of Object.entries(outputs)) await writeFile(path.join(root, name), canonicalBytes(value));
  console.log("contract artifact build: PASS");
} else {
  for (const [name, value] of Object.entries(outputs)) {
    const checked = JSON.parse(await readFile(path.join(root, name), "utf8"));
    if (canonicalJson(checked) !== canonicalJson(value)) throw new Error(`R-003-14: stale ${name}`);
  }
  console.log("contract artifact build check: PASS");
}
