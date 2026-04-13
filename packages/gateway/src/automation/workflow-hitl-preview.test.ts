import { describe, expect, test } from "bun:test";

import { previewHitlActionsForStepText } from "./workflow-hitl-preview.ts";

describe("previewHitlActionsForStepText", () => {
  test("empty string yields no actions", () => {
    expect(previewHitlActionsForStepText("")).toEqual([]);
    expect(previewHitlActionsForStepText("   ")).toEqual([]);
  });

  test("terraform apply and destroy", () => {
    expect(previewHitlActionsForStepText("Run terraform apply in prod")).toEqual([
      "iac.terraform.apply",
    ]);
    expect(previewHitlActionsForStepText("terraform destroy the stack")).toEqual([
      "iac.terraform.destroy",
    ]);
  });

  test("email send", () => {
    expect(previewHitlActionsForStepText("Send an email to the team")).toEqual(["email.send"]);
  });

  test("slack post", () => {
    expect(previewHitlActionsForStepText("Post update to Slack #incidents")).toEqual([
      "slack.message.post",
    ]);
  });

  test("dedupes and sorts multiple matches", () => {
    const r = previewHitlActionsForStepText("Trigger jenkins build and cancel circleci job");
    expect(r).toContain("jenkins.build.trigger");
    expect(r).toContain("circleci.job.cancel");
    expect(r).toEqual([...r].sort((a, b) => a.localeCompare(b)));
  });
});
