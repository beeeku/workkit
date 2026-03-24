import type { WorkflowBuilder, WorkflowDef, WorkflowConfig, StepHandler, StepOptions, StepDefinition, CompensationHandler } from "./types";
import { createWorkflowDef } from "./def";

export function createDurableWorkflow<TInput>(
  name: string,
  config: WorkflowConfig,
): WorkflowBuilder<TInput, {}> {
  const steps: StepDefinition[] = [];

  function makeBuilder<TPrev extends Record<string, unknown>>(): WorkflowBuilder<TInput, TPrev> {
    return {
      step<TName extends string, TOutput>(
        stepName: TName,
        handler: StepHandler<TInput, TPrev, TOutput>,
        options?: StepOptions,
      ): WorkflowBuilder<TInput, TPrev & Record<TName, TOutput>> {
        steps.push({ name: stepName, type: "step", handler, options });
        return makeBuilder<TPrev & Record<TName, TOutput>>();
      },

      onFailure(handler: CompensationHandler<TInput, TPrev>): WorkflowDef<TInput, TPrev> {
        return createWorkflowDef<TInput, TPrev>(name, steps, config, handler);
      },

      build(): WorkflowDef<TInput, TPrev> {
        return createWorkflowDef<TInput, TPrev>(name, steps, config);
      },
    };
  }

  return makeBuilder<{}>();
}

// Deprecated alias
export const createWorkflow: typeof createDurableWorkflow = createDurableWorkflow;
