import { Prisma } from "@prisma/client";

/** Log only actionable slow database operations, without arguments or row data. */
export const performanceExtension = Prisma.defineExtension({
  name: "performance-budget",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const startedAt = performance.now();
        try {
          return await query(args);
        } finally {
          const durationMs = Math.round(performance.now() - startedAt);
          if (durationMs > 1_000) {
            console.warn("[db-query-slow]", JSON.stringify({ model, operation, durationMs }));
          }
        }
      },
    },
  },
});
