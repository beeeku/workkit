import { describe, it, expect, vi } from "vitest";
import { runCompensation } from "../src/compensation";

describe("runCompensation", () => {
  it("calls compensation handler with context", async () => {
    const handler = vi.fn();
    await runCompensation(handler, {
      input: { orderId: "123" },
      failedStep: "charge",
      error: new Error("payment failed"),
      completedSteps: ["validate"],
      stepOutputs: { validate: { valid: true } },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][0];
    expect(ctx.input).toEqual({ orderId: "123" });
    expect(ctx.failedStep).toBe("charge");
    expect(ctx.error.message).toBe("payment failed");
    expect(ctx.completedSteps).toEqual(["validate"]);
    expect(ctx.stepOutputs.validate).toEqual({ valid: true });
    expect(ctx.log).toBeDefined();
  });

  it("does not throw if compensation handler throws", async () => {
    const handler = vi.fn(async () => { throw new Error("compensation failed"); });

    // Should not throw — compensation errors are logged, not propagated
    await expect(runCompensation(handler, {
      input: {},
      failedStep: "step",
      error: new Error("original"),
      completedSteps: [],
      stepOutputs: {},
    })).resolves.not.toThrow();
  });

  it("does nothing when no handler provided", async () => {
    // Should not throw
    await expect(runCompensation(undefined, {
      input: {},
      failedStep: "step",
      error: new Error("test"),
      completedSteps: [],
      stepOutputs: {},
    })).resolves.not.toThrow();
  });
});
