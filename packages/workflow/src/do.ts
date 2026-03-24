import type { StepDefinition, WorkflowConfig, ExecutionMeta, StepJournalEntry } from "./types";
import { createJournal } from "./journal";
import { createExecutor } from "./executor";
import { runCompensation } from "./compensation";

interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: any): Promise<void>;
}

export function createWorkflowExecutionLogic(storage: StorageLike) {
  const journal = createJournal(storage);

  return {
    async execute(
      input: unknown,
      executionId: string,
      steps: StepDefinition[],
      config: WorkflowConfig,
      compensation?: any,
    ): Promise<any> {
      const executor = createExecutor(steps, config, storage, journal);
      const result = await executor.execute(input, executionId);

      if (!result.ok && compensation) {
        const journalEntries = await journal.readAll();
        const completedSteps = journalEntries
          .filter((e) => e.status === "completed")
          .map((e) => e.name);
        const stepOutputs: Record<string, unknown> = {};
        for (const entry of journalEntries) {
          if (entry.status === "completed" && entry.output) {
            stepOutputs[entry.name] = entry.output;
          }
        }

        await runCompensation(compensation, {
          input,
          failedStep: result.error.failedStep,
          error: new Error(result.error.message),
          completedSteps,
          stepOutputs,
        });
      }

      return result;
    },

    async getStatus(): Promise<ExecutionMeta | null> {
      return (await journal.readMeta()) ?? null;
    },

    async getJournal(): Promise<StepJournalEntry[]> {
      return journal.readAll();
    },

    async cancel(): Promise<void> {
      const meta = await journal.readMeta();
      if (meta && !["completed", "failed", "cancelled"].includes(meta.status)) {
        meta.status = "cancelled";
        meta.completedAt = Date.now();
        await journal.writeMeta(meta);
      }
    },
  };
}

// Actual DO class
export class WorkflowExecutionDO implements DurableObject {
  private logic: ReturnType<typeof createWorkflowExecutionLogic>;

  constructor(private state: DurableObjectState) {
    this.logic = createWorkflowExecutionLogic(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/execute") {
        const { input, executionId, steps, config, compensation } =
          (await request.json()) as any;
        const result = await this.logic.execute(
          input,
          executionId,
          steps,
          config,
          compensation,
        );
        return Response.json(result);
      }
      if (request.method === "GET" && url.pathname === "/status") {
        const meta = await this.logic.getStatus();
        return meta
          ? Response.json(meta)
          : Response.json({ error: "Not found" }, { status: 404 });
      }
      if (request.method === "GET" && url.pathname === "/journal") {
        const entries = await this.logic.getJournal();
        return Response.json({ entries });
      }
      if (request.method === "POST" && url.pathname === "/cancel") {
        await this.logic.cancel();
        return Response.json({ ok: true });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
}
