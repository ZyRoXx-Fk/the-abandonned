import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildMongoHarness } from "../helpers/relay-mongo.js";
import { createMongoConnection } from "../../src/config/database.js";
import { proposalRecordSchema } from "../../src/schemas/action.schema.js";
import { businessDraftSchema } from "../../src/schemas/catalog.schema.js";
import { RelayError } from "../../src/utils/relay-error.js";
import { inventoryKeyForVariant } from "../../src/repositories/catalog.repository.js";
import { MongoUnitOfWork } from "../../src/repositories/unit-of-work.js";

const execFile = promisify(execFileCallback);

const publishedDraft = businessDraftSchema.parse({
  id: "draft_restaurant_1",
  businessId: "business_restaurant_1",
  ownerId: "owner_restaurant_1",
  category: "restaurant",
  revision: 3,
  profile: {
    name: "Brasserie Relay",
    address: "Marktplatz 1, Basel",
    description: "Seasonal plates",
    contact: { email: "owner@example.com" },
    timezone: "Europe/Zurich",
    currency: "CHF",
    openingHours: [{ day: "monday", intervals: [{ startTime: "09:00", endTime: "22:00" }] }],
    serviceHours: [{ id: "dinner", label: "Dinner", days: ["monday"], startTime: "18:00", endTime: "22:00" }],
    finalPriceDescription: "Taxes included.",
    policies: ["Arrive on time."],
    categoryConfig: { kind: "restaurant", cuisine: "Swiss", amenities: ["terrace"] },
  },
  offerings: [
    {
      kind: "menu_item",
      id: "soup",
      active: true,
      name: "Soup",
      variants: [{ id: "bowl", name: "Bowl", unitPrice: { amountMinor: 1200, currency: "CHF" } }],
    },
  ],
  inventoryEdits: [
    {
      kind: "sellable_variant",
      id: "soup_bowl_stock",
      offeringId: "soup",
      variantId: "bowl",
      remainingUnits: 4,
    },
  ],
  auditTrail: [],
  createdAt: "2027-03-01T10:00:00.000Z",
  updatedAt: "2027-03-01T10:00:00.000Z",
} as const);

function buildOrderProposal() {
  return proposalRecordSchema.parse({
    id: `proposal_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    principal: { role: "client", userId: "client_1" },
    revision: 0,
    kind: "order",
    payload: {
      kind: "order",
      businessId: publishedDraft.businessId,
      items: [{ offeringId: "soup", variantId: "bowl", quantity: 2 }],
      pickupAt: "2027-03-02T18:30:00.000+01:00",
    },
    summary: {
      kind: "order",
      businessId: publishedDraft.businessId,
      items: [{
        offeringId: "soup",
        variantId: "bowl",
        name: "Soup / Bowl",
        quantity: 2,
        unitPrice: { amountMinor: 1200, currency: "CHF" },
        lineTotal: { amountMinor: 2400, currency: "CHF" },
      }],
      totalPrice: { amountMinor: 2400, currency: "CHF" },
      pickupAt: "2027-03-02T18:30:00.000+01:00",
      chargeDescription: "Soup pickup",
      policies: ["Arrive on time."],
      paymentNotice: "Demo payment due at pickup.",
    },
    termsRevision: {
      businessRevision: publishedDraft.revision,
      offeringRevisions: [{ id: "soup", revision: 0 }],
      inventoryRevisions: [],
    },
    expiresAt: "2027-03-01T10:15:00.000Z",
    state: "pending",
    durableResultRef: null,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildStandaloneDatabaseName(): string {
  return `relay_test_standalone_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function docker(args: string[]): Promise<void> {
  await execFile("docker", args, { encoding: "utf8" });
}

async function waitForStandaloneMongo(
  uri: string,
  process?: ChildProcessWithoutNullStreams,
  lastOutput?: () => string,
): Promise<void> {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    if (process && process.exitCode !== null) {
      const output = lastOutput?.().trim();
      throw new Error(output.length > 0
        ? `Standalone MongoDB exited before readiness: ${output}`
        : `Standalone MongoDB exited before readiness with code ${process.exitCode}`);
    }

    try {
      const connection = await createMongoConnection(uri);
      await connection.close();
      return;
    } catch {
      await sleep(500);
    }
  }

  throw new Error(`Timed out waiting for standalone MongoDB at ${uri}`);
}

async function stopNativeStandaloneMongo(
  process: ChildProcessWithoutNullStreams,
  dbPath: string,
): Promise<void> {
  if (process.exitCode === null) {
    process.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => process.once("exit", () => resolve())),
      sleep(5000).then(() => {
        if (process.exitCode === null) {
          process.kill("SIGKILL");
        }
      }),
    ]);
  }

  await rm(dbPath, { recursive: true, force: true });
}

async function verifyNativeMongoBinary(binaryPath: string): Promise<void> {
  const { stdout, stderr } = await execFile(binaryPath, ["--version"], { encoding: "utf8" });
  assert.match(`${stdout}${stderr}`, /db version v8\./);
}

async function startStandaloneMongoNative(binaryPath: string): Promise<{ uri: string; stop(): Promise<void> }> {
  await verifyNativeMongoBinary(binaryPath);

  const dbPath = await mkdtemp(join(tmpdir(), "relay-mongo-standalone-"));
  const databaseName = buildStandaloneDatabaseName();
  const uri = `mongodb://127.0.0.1:27019/${databaseName}`;
  let lastOutput = "";
  const process = spawn(binaryPath, [
    "--bind_ip",
    "127.0.0.1",
    "--port",
    "27019",
    "--dbpath",
    dbPath,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const recordOutput = (chunk: Buffer) => {
    const lines = `${lastOutput}\n${chunk.toString("utf8")}`.trim().split("\n");
    lastOutput = lines.slice(-5).join(" | ");
  };
  process.stdout.on("data", recordOutput);
  process.stderr.on("data", recordOutput);

  try {
    await waitForStandaloneMongo(uri, process, () => lastOutput);
    return {
      uri,
      async stop(): Promise<void> {
        await stopNativeStandaloneMongo(process, dbPath);
      },
    };
  } catch (error) {
    await stopNativeStandaloneMongo(process, dbPath);
    throw error;
  }
}

async function startStandaloneMongoDocker(): Promise<{ uri: string; stop(): Promise<void> }> {
  const containerName = `relay-mongo-standalone-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const databaseName = buildStandaloneDatabaseName();
  const uri = `mongodb://127.0.0.1:27019/${databaseName}`;

  await docker([
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-p",
    "127.0.0.1:27019:27017",
    "mongo:8.0",
    "--bind_ip",
    "0.0.0.0",
  ]);
  await waitForStandaloneMongo(uri);

  return {
    uri,
    async stop(): Promise<void> {
      await docker(["rm", "-f", containerName]);
    },
  };
}

async function startStandaloneMongo(): Promise<{ uri: string; stop(): Promise<void> }> {
  const nativeBinary = process.env.TEST_MONGOD_BINARY?.trim();
  return nativeBinary ? startStandaloneMongoNative(nativeBinary) : startStandaloneMongoDocker();
}

test("mongo transactions roll back inventory plus action/event writes when work throws", async (t) => {
  const harness = await buildMongoHarness();
  t.after(() => harness.close());

  await harness.catalog.insertDraft(publishedDraft);
  await harness.uow.run((tx) => harness.catalog.publish(publishedDraft, tx));

  const inventoryKey = inventoryKeyForVariant(publishedDraft.businessId, "soup", "bowl");
  const [before] = await harness.catalog.getInventory([inventoryKey]);
  assert.equal(before?.kind, "sellable_variant");
  assert.equal(before?.remainingUnits, 4);

  const proposal = buildOrderProposal();
  let rolledBackActionId: string | null = null;

  await assert.rejects(
    () => harness.uow.run(async (tx) => {
      await harness.catalog.applyAllocations([{ key: inventoryKey, delta: 2 }], tx);
      const result = await harness.transactions.insertAction({ role: "client", userId: "client_1" }, proposal, tx);
      rolledBackActionId = result.id;
      await harness.transactions.appendEvent({ role: "client", userId: "client_1" }, proposal, result, tx);
      throw new Error("force rollback");
    }),
    /force rollback/,
  );

  const [afterRollback] = await harness.catalog.getInventory([inventoryKey]);
  assert.equal(afterRollback?.kind, "sellable_variant");
  assert.equal(afterRollback?.remainingUnits, 4);
  assert.equal(rolledBackActionId === null, false);
  assert.equal(await harness.transactions.getCustomerAction("client_1", rolledBackActionId as string), null);

  const committed = await harness.uow.run(async (tx) => {
    await harness.catalog.applyAllocations([{ key: inventoryKey, delta: 2 }], tx);
    const result = await harness.transactions.insertAction({ role: "client", userId: "client_1" }, proposal, tx);
    await harness.transactions.appendEvent({ role: "client", userId: "client_1" }, proposal, result, tx);
    return result;
  });

  const [afterCommit] = await harness.catalog.getInventory([inventoryKey]);
  assert.equal(afterCommit?.kind, "sellable_variant");
  assert.equal(afterCommit?.remainingUnits, 2);
  assert.deepEqual(await harness.transactions.getCustomerAction("client_1", committed.id), committed);
});

test("standalone MongoDB rejects transactional work with TRANSACTIONS_REQUIRED", async (t) => {
  const standalone = await startStandaloneMongo();
  t.after(() => standalone.stop());

  const connection = await createMongoConnection(standalone.uri);
  t.after(() => connection.close());

  const uow = new MongoUnitOfWork(connection);
  await assert.rejects(
    () => uow.assertSupported(),
    (error: unknown) => {
      assert.ok(error instanceof RelayError);
      assert.equal(error.code, "TRANSACTIONS_REQUIRED");
      assert.match(error.message, /replica set|sharded cluster/i);
      return true;
    },
  );
});
