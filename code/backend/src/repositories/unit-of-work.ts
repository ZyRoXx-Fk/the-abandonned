import type { ClientSession, Connection } from "mongoose";
import { RelayError } from "../utils/relay-error.js";

export interface UnitOfWork {
  run<T>(work: (tx: ClientSession) => Promise<T>): Promise<T>;
  assertSupported(): Promise<void>;
}

export class MongoUnitOfWork implements UnitOfWork {
  constructor(private readonly connection: Connection) {}

  async assertSupported(): Promise<void> {
    const database = this.connection.db;
    if (!database) {
      throw new RelayError("TRANSACTIONS_REQUIRED", "MongoDB connection is not ready for transactional relay storage.");
    }

    const admin = database.admin();
    const hello = await admin.command({ hello: 1 });
    const supportsTransactions = typeof hello.setName === "string" || hello.msg === "isdbgrid";

    if (!supportsTransactions) {
      throw new RelayError(
        "TRANSACTIONS_REQUIRED",
        "MongoDB transactions require a replica set or sharded cluster. Configure TEST_MONGODB_URI for relay-rs or Atlas.",
      );
    }
  }

  async run<T>(work: (tx: ClientSession) => Promise<T>): Promise<T> {
    await this.assertSupported();
    const session = await this.connection.startSession();

    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }
}
