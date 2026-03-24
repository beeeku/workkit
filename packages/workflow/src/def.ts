import type {
  WorkflowDef,
  WorkflowConfig,
  StepDefinition,
  CompensationHandler,
  ExecutionHandle,
  ExecutionMeta,
  StepJournalEntry,
  RunOptions,
} from "./types";
import { generateExecutionId } from "./utils";

export function createWorkflowDef<
  TInput,
  TOutput extends Record<string, unknown>,
>(
  name: string,
  steps: StepDefinition[],
  config: WorkflowConfig,
  compensation?: CompensationHandler<TInput, TOutput>,
): WorkflowDef<TInput, TOutput> {
  function createHandle(executionId: string): ExecutionHandle<TOutput> {
    return {
      executionId,

      async status(): Promise<any> {
        if (config.backend.type !== "do")
          throw new Error("Only DO backend supported in v0.1.0");
        const doId = config.backend.namespace.idFromName(executionId);
        const stub = config.backend.namespace.get(doId);
        const res = await stub.fetch(new Request("https://internal/status"));
        if (!res.ok) return "pending";
        const meta = (await res.json()) as ExecutionMeta;
        return meta.status;
      },

      async result(): Promise<any> {
        const currentStatus = await this.status();
        if (currentStatus === "completed")
          return { ok: true, value: {} as TOutput };
        if (currentStatus === "failed")
          return {
            ok: false,
            error: {
              executionId,
              failedStep: "",
              stepAttempt: 0,
              message: "Workflow failed",
              journal: [],
            },
          };
        return {
          ok: false,
          error: {
            executionId,
            failedStep: "",
            stepAttempt: 0,
            message: `Workflow is ${currentStatus}`,
            journal: [],
          },
        };
      },

      async meta(): Promise<ExecutionMeta> {
        if (config.backend.type !== "do")
          throw new Error("Only DO backend supported in v0.1.0");
        const doId = config.backend.namespace.idFromName(executionId);
        const stub = config.backend.namespace.get(doId);
        const res = await stub.fetch(new Request("https://internal/status"));
        return res.json();
      },

      async journal(): Promise<StepJournalEntry[]> {
        if (config.backend.type !== "do")
          throw new Error("Only DO backend supported in v0.1.0");
        const doId = config.backend.namespace.idFromName(executionId);
        const stub = config.backend.namespace.get(doId);
        const res = await stub.fetch(new Request("https://internal/journal"));
        const data = (await res.json()) as any;
        return data.entries;
      },

      async resume() {
        throw new Error("Not supported in v0.1.0");
      },

      async cancel() {
        if (config.backend.type !== "do")
          throw new Error("Only DO backend supported in v0.1.0");
        const doId = config.backend.namespace.idFromName(executionId);
        const stub = config.backend.namespace.get(doId);
        await stub.fetch(
          new Request("https://internal/cancel", { method: "POST" }),
        );
      },
    };
  }

  return {
    name,
    version: config.version ?? "0.0.0",

    async run(
      input: TInput,
      options?: RunOptions,
    ): Promise<ExecutionHandle<TOutput>> {
      if (config.backend.type !== "do")
        throw new Error("Only DO backend supported in v0.1.0");

      const executionId = options?.executionId ?? generateExecutionId();
      const doId = config.backend.namespace.idFromName(executionId);
      const stub = config.backend.namespace.get(doId);

      await stub.fetch(
        new Request("https://internal/execute", {
          method: "POST",
          body: JSON.stringify({
            input,
            executionId,
            steps,
            config: { version: config.version },
            compensation: undefined,
          }),
        }),
      );

      return createHandle(executionId);
    },

    async cancel(executionId: string): Promise<void> {
      const handle = createHandle(executionId);
      await handle.cancel();
    },

    execution(executionId: string): ExecutionHandle<TOutput> {
      return createHandle(executionId);
    },
  };
}
