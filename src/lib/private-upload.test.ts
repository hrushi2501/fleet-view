import assert from "node:assert/strict";
import { test } from "node:test";
import { detectAllowedFile } from "./file-signature";

test("spoken driver-report formats require recognizable audio containers", () => {
  assert.deepEqual(detectAllowedFile(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])), {
    extension: "webm", contentType: "audio/webm",
  });
  assert.deepEqual(detectAllowedFile(new Uint8Array([0x4f, 0x67, 0x67, 0x53])), {
    extension: "ogg", contentType: "audio/ogg",
  });
  assert.deepEqual(detectAllowedFile(new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70])), {
    extension: "m4a", contentType: "audio/mp4",
  });
  assert.equal(detectAllowedFile(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), null);
});
