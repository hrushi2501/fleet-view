import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { recordScope, assertGlobalAccess } from "./record-access";
import type { Access } from "./access";

const access = { group: "SUPERVISOR", projectIds: ["site-a"], driverId: null } as Access;
const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
function validateWhere(modelName: string, where: Record<string, unknown>) {
  const model = models.get(modelName)!;
  for (const [key, value] of Object.entries(where)) {
    if (["AND", "OR", "NOT"].includes(key)) {
      for (const item of Array.isArray(value) ? value : [value]) validateWhere(modelName, item);
      continue;
    }
    const field = model.fields.find(field => field.name === key);
    assert.ok(field, `Invalid scope field ${modelName}.${key}`);
    if (field.kind === "object" && value && typeof value === "object") {
      for (const [nested, body] of Object.entries(value)) {
        if (["some", "every", "none", "is", "isNot"].includes(nested)) validateWhere(field.type, body);
        else validateWhere(field.type, { [nested]: body });
      }
    }
  }
}
test("every scoped model filter uses real Prisma fields and relations", () => {
  for (const name of models.keys()) {
    const delegate = name[0].toLowerCase() + name.slice(1);
    const scope = recordScope(delegate, access);
    if (JSON.stringify(scope) !== JSON.stringify({ id: "__none__" })) validateWhere(name, scope);
  }
});
test("restricted users cannot edit unassigned shared records", () => {
  assert.throws(() => assertGlobalAccess(access), /unrestricted manager/);
  assert.deepEqual(recordScope("unmappedModel", access), { id: "__none__" });
});
test("a missing driver link does not widen asset access", () => {
  assert.deepEqual(recordScope("driver", { ...access, group: "DRIVER" }), { id: "__none__" });
});
