import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { secureWebhookUrl, shouldSendSecurityAlert } from "./security-alerts.ts";

describe("security monitoring routing", () => {
  test("only denials and failed logins become external security alerts", () => {
    assert.equal(shouldSendSecurityAlert("DENIED"), true);
    assert.equal(shouldSendSecurityAlert("LOGIN_FAILED"), true);
    assert.equal(shouldSendSecurityAlert("LOGIN"), false);
    assert.equal(shouldSendSecurityAlert("UPDATE"), false);
  });

  test("webhook destinations must use HTTPS", () => {
    assert.equal(secureWebhookUrl("https://monitor.example/events"), "https://monitor.example/events");
    assert.equal(secureWebhookUrl("http://monitor.example/events"), null);
    assert.equal(secureWebhookUrl("not a url"), null);
    assert.equal(secureWebhookUrl(undefined), null);
  });
});
