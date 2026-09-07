import { Prisma } from "@prisma/client";
import { rawDb } from "./db";
import { auditableModel, moduleForModel } from "./audit-models";

export type Transaction = Prisma.TransactionClient;
export type Actor = { id: string; name: string; role: string } | null;
const writes = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

/** Audit through the transaction's connection. A rollback rolls back its audit too. */
export function auditedTransaction(tx: Transaction, actor: Actor): Transaction {
  return new Proxy(tx, {
    get(target, key) {
      const member = Reflect.get(target, key);
      if (typeof key !== "string" || key.startsWith("$") || !member || typeof member !== "object") {
        return typeof member === "function" ? member.bind(target) : member;
      }
      const model = key[0].toUpperCase() + key.slice(1);
      if (!auditableModel(model)) return member;
      return new Proxy(member, {
        get(delegate, operation) {
          const method = Reflect.get(delegate, operation);
          if (typeof method !== "function") return method;
          if (!writes.has(String(operation))) return method.bind(delegate);
          return async (...args: unknown[]) => {
            const result = await method.apply(delegate, args);
            // A failed conditional update made no business change.
            if (result?.count === 0) return result;
            const input = args[0] as { where?: { id?: string } } | undefined;
            const action = String(operation).startsWith("create") ? "CREATE" : String(operation).startsWith("delete") ? "DELETE" : "UPDATE";
            await tx.auditEvent.create({ data: {
              actorId: actor?.id ?? null, actorName: actor?.name ?? "System", actorRole: actor?.role ?? null,
              action, module: moduleForModel(model), entity: model,
              entityId: result?.id ?? input?.where?.id ?? null,
              summary: `${action} ${model}${typeof result?.count === "number" ? ` (${result.count} records)` : ""}`,
            } });
            return result;
          };
        },
      });
    },
  });
}

/** Callback must contain only database work: it can be retried after a serialization conflict. */
export async function businessTransaction<T>(actor: Actor, work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawDb.$transaction(tx => work(auditedTransaction(tx, actor)), {
        isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt >= 2) throw error;
    }
  }
}
