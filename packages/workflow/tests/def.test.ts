import { describe, it, expect, vi } from "vitest";
import { createWorkflowDef } from "../src/def";
import type { StepDefinition, WorkflowConfig } from "../src/types";

function createMockDONamespace() {
  return {
    idFromName: (name: string) => ({ toString: () => name }),
    get: () => ({
      fetch: vi.fn(async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === "/execute")
          return Response.json({
            ok: true,
            value: { step1: { done: true } },
          });
        if (url.pathname === "/status")
          return Response.json({
            executionId: "wf_test",
            status: "completed",
            workflowName: "test",
            workflowVersion: "1.0.0",
            createdAt: Date.now(),
            stepCount: 1,
            completedStepCount: 1,
          });
        if (url.pathname === "/journal")
          return Response.json({
            entries: [
              {
                index: 0,
                name: "step1",
                status: "completed",
                output: { done: true },
                attempt: 1,
              },
            ],
          });
        if (url.pathname === "/cancel") return Response.json({ ok: true });
        return Response.json({}, { status: 404 });
      }),
    }),
  } as any;
}

describe("createWorkflowDef", () => {
  const steps: StepDefinition[] = [
    {
      name: "step1",
      type: "step",
      handler: async () => ({ done: true }),
    },
  ];
  const config: WorkflowConfig = {
    backend: { type: "do", namespace: createMockDONamespace() },
    version: "1.0.0",
  };

  it("has correct name and version", () => {
    const def = createWorkflowDef("test-workflow", steps, config);
    expect(def.name).toBe("test-workflow");
    expect(def.version).toBe("1.0.0");
  });

  it("run() returns an ExecutionHandle", async () => {
    const def = createWorkflowDef("test", steps, config);
    const handle = await def.run({ data: "test" });

    expect(handle.executionId).toBeDefined();
    expect(handle.status).toBeDefined();
    expect(handle.meta).toBeDefined();
    expect(handle.journal).toBeDefined();
    expect(handle.cancel).toBeDefined();
  });

  it("execution() returns a handle for existing execution", () => {
    const def = createWorkflowDef("test", steps, config);
    const handle = def.execution("wf_existing");
    expect(handle.executionId).toBe("wf_existing");
  });

  it("handle.status() returns workflow status", async () => {
    const def = createWorkflowDef("test", steps, config);
    const handle = await def.run({});
    const status = await handle.status();
    expect(status).toBe("completed");
  });

  it("handle.journal() returns step entries", async () => {
    const def = createWorkflowDef("test", steps, config);
    const handle = await def.run({});
    const entries = await handle.journal();
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("step1");
  });
});
