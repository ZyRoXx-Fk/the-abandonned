import { randomUUID } from "node:crypto";
import type { Connection } from "mongoose";

const MAX_DATABASE_NAME_LENGTH = 38;
import { createMongoConnection } from "../../src/config/database.js";
import { getActionEventModel } from "../../src/models/action-event.model.js";
import { getActionProposalModel } from "../../src/models/action-proposal.model.js";
import { getBusinessDraftModel } from "../../src/models/business-draft.model.js";
import { getBusinessModel } from "../../src/models/business.model.js";
import { getInventoryModel } from "../../src/models/inventory.model.js";
import { getOfferingModel } from "../../src/models/offering.model.js";
import { getOrderModel } from "../../src/models/order.model.js";
import { getReservationModel } from "../../src/models/reservation.model.js";
import { MongoCatalogRepository } from "../../src/repositories/catalog.repository.js";
import { MongoProposalRepository } from "../../src/repositories/proposal.repository.js";
import { MongoTransactionRepository } from "../../src/repositories/transaction.repository.js";
import { MongoUnitOfWork } from "../../src/repositories/unit-of-work.js";

export function buildSuiteUri(): { uri: string; databaseName: string } {
  const baseUri = process.env.TEST_MONGODB_URI;
  if (!baseUri) {
    throw new Error("TEST_MONGODB_URI must be set for relay storage tests.");
  }

  const parsed = new URL(baseUri);
  const baseDatabaseName = parsed.pathname.replace(/^\//, "");
  if (!baseDatabaseName.startsWith("relay_test")) {
    throw new Error("TEST_MONGODB_URI must target an explicitly disposable relay_test-prefixed database.");
  }

  const availableSuffixLength = MAX_DATABASE_NAME_LENGTH - baseDatabaseName.length - 1;
  if (availableSuffixLength < 8) {
    throw new Error("TEST_MONGODB_URI base database name leaves insufficient room for an isolated relay_test suffix.");
  }

  const databaseName = `${baseDatabaseName}_${randomUUID().replace(/-/g, "").slice(0, availableSuffixLength)}`;
  parsed.pathname = `/${databaseName}`;
  return { uri: parsed.toString(), databaseName };
}

async function buildIndexes(connection: Connection): Promise<void> {
  await Promise.all([
    getBusinessModel(connection).init(),
    getBusinessDraftModel(connection).init(),
    getOfferingModel(connection).init(),
    getInventoryModel(connection).init(),
    getActionProposalModel(connection).init(),
    getOrderModel(connection).init(),
    getReservationModel(connection).init(),
    getActionEventModel(connection).init(),
  ]);
}

export async function buildMongoHarness(): Promise<{
  connection: Connection;
  catalog: MongoCatalogRepository;
  proposals: MongoProposalRepository;
  transactions: MongoTransactionRepository;
  uow: MongoUnitOfWork;
  close(): Promise<void>;
}> {
  const { uri, databaseName } = buildSuiteUri();
  const connection = await createMongoConnection(uri);

  try {
    await buildIndexes(connection);

    const catalog = new MongoCatalogRepository(connection);
    const proposals = new MongoProposalRepository(connection);
    const transactions = new MongoTransactionRepository(connection);
    const uow = new MongoUnitOfWork(connection);

    return {
      connection,
      catalog,
      proposals,
      transactions,
      uow,
      async close(): Promise<void> {
        await connection.db?.dropDatabase();
        await connection.close();
        void databaseName;
      },
    };
  } catch (error) {
    await connection.close().catch(() => undefined);
    throw error;
  }
}
