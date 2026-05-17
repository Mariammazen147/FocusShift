import * as vscode from "vscode";
import { EditorContext } from "../core/stateManager";

type Scenario =
  | "development"
  | "bug-fixing"
  | "code-review"
  | "problem-understanding";

export class SummaryService {
  private inferScenario(ctx: EditorContext): Scenario {
    const editCount = ctx.editHistory.length;
    const cursorCount = ctx.cursorHistory.length;
    const scrollCount = ctx.scrollHistory.length;
    const tabCount = ctx.tabHistory.length;

    if (scrollCount > editCount * 2 && tabCount > 2) {
      return "code-review";
    }
    if (editCount > 5 && cursorCount > editCount) {
      return "bug-fixing";
    }
    if (scrollCount > 5 && editCount < 3) {
      return "problem-understanding";
    }
    return "development";
  }

  private buildPrompt(
    ctx: EditorContext,
    scenario: Scenario,
  ): { system: string; user: string } {
    const fileName = ctx.fileUri.split("/").pop() ?? ctx.fileUri;
    const lineNum = ctx.position.line + 1;

    const recentEdits =
      ctx.editHistory
        .slice(-5)
        .map((e) => `  [${e.time}] ${e.change}`)
        .join("\n") || "  (none)";
    const recentCursors =
      ctx.cursorHistory
        .slice(-5)
        .map((c) => `  [${c.time}] ${c.action}`)
        .join("\n") || "  (none)";
    const recentTabs =
      ctx.tabHistory
        .slice(-5)
        .map((t) => `  [${t.time}] ${t.action}`)
        .join("\n") || "  (none)";

    // Each scenario gets its own focus hint for the system role
    // and a specific closing instruction that steers the LLM's suggestion.
    const scenarioConfig: Record<
      Scenario,
      { focus: string; instruction: string }
    > = {
      development: {
        focus:
          "The developer was in a steady coding flow. Help them pick up exactly where they left off and suggest the next logical piece of code to write.",
        instruction:
          "Tell them what they were building, then suggest the next function, method, or logic block to add.",
      },
      "bug-fixing": {
        focus:
          "The developer was hunting a bug — lots of edits and cursor jumping. Help them re-focus on the suspicious area and suggest where to look next.",
        instruction:
          "Mention the area they were investigating and suggest a specific line range or variable to inspect next.",
      },
      "code-review": {
        focus:
          "The developer was reviewing code — mostly scrolling and switching tabs with few edits. Help them remember what they were evaluating.",
        instruction:
          "Describe what they were reviewing and suggest the next section or file to check.",
      },
      "problem-understanding": {
        focus:
          "The developer was reading and trying to understand how something works — minimal edits, lots of scrolling. Help them re-orient to the concept.",
        instruction:
          "Name the part of the code they were studying and suggest a concrete next step to deepen understanding (e.g. check a related function, read a comment block, or add a breakpoint).",
      },
    };

    const { focus, instruction } = scenarioConfig[scenario];

    const system =
      'Do NOT start with "Sure", "Of course", "Great", or any filler. Start directly with "You were..." or similar. Do NOT include any code snippets or code blocks in your response. Plain English sentences only. ' +
      'No sign-off phrases like "If you have any questions, feel free to ask" or "Let me know if you need help". End after your last sentence of context.';
    const errorSummary = this.summariseErrors(ctx.errors ?? []);

    const user =
      `FILE: ${fileName}\n` +
      `LANGUAGE: ${ctx.language}\n` +
      `LINE: ${lineNum}\n` +
      `DETECTED ACTIVITY TYPE: ${scenario}\n` +
      `\nCODE SNIPPET:\n${ctx.snippet}\n` +
      `\nRECENT EDITS:\n${recentEdits}\n` +
      `\nRECENT CURSOR MOVEMENTS:\n${recentCursors}\n` +
      `\nTAB SWITCHES:\n${recentTabs}\n` +
      `\nERRORS / WARNINGS AT INTERRUPTION TIME:\n${errorSummary}\n` +
      `\nInstruction: start with "You were". ${instruction}`;

    return { system, user };
  }

  private summariseErrors(
    errors: { line: number; severity: string; message: string }[],
  ): string {
    if (!errors || errors.length === 0) {
      return "  (no errors or warnings at interruption time)";
    }
    const relevant = errors.filter(
      (e) => e.severity === "Error" || e.severity === "Warning",
    );
    if (relevant.length === 0) {
      return "  (no errors or warnings at interruption time)";
    }
    return relevant
      .slice(0, 5)
      .map((e) => `  Line ${e.line} [${e.severity}]: ${e.message}`)
      .join("\n");
  }

  private cleanResponse(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/^[-•]\s+/gm, '')
      .replace(/\n{2,}/g, ' ')
      .replace(/if you (have|encounter|need|want).{0,120}(ask|me|help)!?\.?/gi, '')
      .replace(/feel free to .{0,80}!?\.?/gi, '')
      .replace(/let me know .{0,80}!?\.?/gi, '')
      .replace(/don't hesitate to .{0,80}!?\.?/gi, '')
      .replace(/happy to help.{0,50}!?\.?/gi, '')
      .trim();
  }

  public async generateLLMSummary(
    ctx: EditorContext,
  ): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration("focusshift");

    if (!config.get<boolean>("enableLLMSummary", true)) {
      return undefined;
    }

    const model = config.get<string>("llmModel", "qwen2.5-coder:1.5b-instruct");

    const scenario: Scenario = this.inferScenario(ctx);

    const { system, user } = this.buildPrompt(ctx, scenario);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch("http://localhost:11434/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: false,
          options: {
            temperature: 0.4,
            num_predict: 300,
          },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!response.ok) {
        console.warn(
          `FocusShift SummaryService: Ollama returned HTTP ${response.status}`,
        );
        return undefined;
      }

      const data = (await response.json()) as any;
      const text: string | undefined = data?.message?.content?.trim();

      if (!text) {
        console.warn("FocusShift SummaryService: Empty response from Ollama");
        return undefined;
      }

      return this.cleanResponse(text);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        console.warn(
          "FocusShift SummaryService: Ollama request timed out after 15 s",
        );
      } else {
        console.warn(
          "FocusShift SummaryService: Ollama not reachable —",
          err?.message ?? err,
        );
      }
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }
}
1;
