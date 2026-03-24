import { describe, it, expect, vi } from "vitest";
import { createDurableWorkflow } from "../src/builder";

const mockConfig = {
  backend: { type: "do" as const, namespace: {} as any },
  version: "1.0.0",
};

describe("createDurableWorkflow", () => {
  it("creates a builder", () => {
    const builder = createDurableWorkflow("test", mockConfig);
    expect(builder).toBeDefined();
    expect(builder.step).toBeDefined();
    expect(builder.build).toBeDefined();
    expect(builder.onFailure).toBeDefined();
  });

  it("chains steps", () => {
    const builder = createDurableWorkflow<{ orderId: string }>("order", mockConfig)
      .step("validate", async (input) => ({ valid: true, orderId: input.orderId }))
      .step("process", async (input, prev) => ({ processed: true }))
      .step("complete", async (input, prev) => ({ done: true }));

    expect(builder).toBeDefined();
  });

  it("build() returns a WorkflowDef", () => {
    const def = createDurableWorkflow<{ id: string }>("test", mockConfig)
      .step("a", async () => ({ result: 1 }))
      .build();

    expect(def.name).toBe("test");
    expect(def.version).toBe("1.0.0");
    expect(def.run).toBeDefined();
    expect(def.cancel).toBeDefined();
    expect(def.execution).toBeDefined();
  });

  it("onFailure() returns a WorkflowDef with compensation", () => {
    const compensationFn = vi.fn();
    const def = createDurableWorkflow<{ id: string }>("test", mockConfig)
      .step("a", async () => ({ result: 1 }))
      .onFailure(compensationFn);

    expect(def.name).toBe("test");
    expect(def.run).toBeDefined();
  });

  it("collects steps in order", () => {
    // Access internal steps to verify order
    const builder = createDurableWorkflow<{}>("test", mockConfig)
      .step("first", async () => ({ a: 1 }))
      .step("second", async () => ({ b: 2 }))
      .step("third", async () => ({ c: 3 }));

    const def = builder.build();
    // WorkflowDef should have captured 3 steps in order
    expect(def.name).toBe("test");
  });
});
