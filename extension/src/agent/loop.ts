/**
 * The Agentic Loop — core engine of RewindAI.
 *
 * Orchestrates: User message → LLM → (tool calls → execute → results → LLM)* → final response
 *
 * The loop continues until the LLM responds with only text (no tool_use blocks)
 * or we hit MAX_ITERATIONS. Context is auto-saved on git commit by GitWatcher.
 */

import { LLMClient, LLMMessage, LLMConfig, ContentBlock } from '../llm/client';
import { ToolExecutor } from '../tools/executor';
import { ContextManager } from '../context/manager';

const MAX_ITERATIONS = 25;

export interface AgentEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'thinking' | 'done';
  content: string;
  toolName?: string;
  isError?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

const BASE_SYSTEM_PROMPT = `You are RewindAI — an AI coding assistant running inside a VS Code extension. You have version-controlled memory: your conversation context is automatically saved when the developer commits code, and restored when they checkout a previous commit.

You can read, write, and edit files in the developer's project. You can run terminal commands. You can search across the codebase.

HOW TO WORK:
1. ALWAYS read a file before editing it. Use read_file first.
2. Use edit_file for targeted changes. Use write_file only for new files or complete rewrites.
3. After making changes, run relevant commands to verify (npm test, npm run build, etc.).
4. When you make a technical decision, state it clearly: "Decision: [what] because [why]"
5. Break complex tasks into steps. Tell the user what you're doing at each step.
6. If something fails, read the error and try a different approach.
7. Be concise — the user reads your responses in a narrow panel.

ABOUT YOUR MEMORY:
- Your conversation history is tied to git commits
- When the developer commits, everything we've discussed is saved
- When they checkout a different commit, you remember what was discussed at THAT point
- If restored context is provided below, use it for continuity

DO NOT:
- Make changes without reading the file first
- Run dangerous commands (rm -rf, etc.)
- Guess at file contents — always read them
- Write overly long responses`;

export class AgentLoop {
  private llmClient: LLMClient;
  private toolExecutor: ToolExecutor;
  private contextManager: ContextManager;
  private conversationHistory: LLMMessage[] = [];

  constructor(
    config: LLMConfig,
    toolExecutor: ToolExecutor,
    contextManager: ContextManager,
  ) {
    this.llmClient = new LLMClient(config);
    this.toolExecutor = toolExecutor;
    this.contextManager = contextManager;
  }

  /**
   * Run the agent with a user message.
   * Events are emitted via onEvent for the UI to display.
   */
  async run(userMessage: string, onEvent: AgentEventHandler): Promise<void> {
    let systemPrompt = BASE_SYSTEM_PROMPT;

    const restoredContext = this.contextManager.getCurrentContextSummary();
    if (restoredContext) {
      systemPrompt += '\n\n══════════════════════════════════════\n';
      systemPrompt += 'RESTORED CONTEXT FROM A PREVIOUS COMMIT:\n';
      systemPrompt += '══════════════════════════════════════\n';
      systemPrompt += restoredContext;
    }

    const scratchpad = this.contextManager.getScratchpad();
    if (scratchpad.length > 0) {
      systemPrompt += '\n\nSESSION SCRATCHPAD (decisions and notes):\n';
      systemPrompt += scratchpad.map(n => `• ${n}`).join('\n');
    }

    this.conversationHistory.push({ role: 'user', content: userMessage });
    this.contextManager.addMessage('user', userMessage);

    const tools = this.toolExecutor.getToolDefinitions();
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      if (iterations > 1) {
        onEvent({ type: 'thinking', content: `Thinking... (step ${iterations})` });
      }

      let response;
      try {
        response = await this.llmClient.sendRequest(systemPrompt, this.conversationHistory, tools);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        onEvent({ type: 'error', content: msg, isError: true });
        this.contextManager.addMessage('assistant', `[Error: ${msg}]`);
        return;
      }

      let hasToolUse = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResultBlocks: any[] = [];
      let fullTextResponse = '';

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          fullTextResponse += block.text;
          onEvent({ type: 'text', content: block.text });
        }

        if (block.type === 'tool_use' && block.id && block.name && block.input) {
          hasToolUse = true;

          const inputSummary = JSON.stringify(block.input);
          const truncatedInput = inputSummary.length > 150
            ? inputSummary.substring(0, 150) + '...'
            : inputSummary;

          onEvent({ type: 'tool_call', content: truncatedInput, toolName: block.name });

          const result = await this.toolExecutor.execute({
            id: block.id,
            name: block.name,
            input: block.input,
          });

          const displayResult = result.content.length > 500
            ? result.content.substring(0, 500) + '\n... (truncated)'
            : result.content;

          onEvent({ type: 'tool_result', content: displayResult, toolName: block.name, isError: result.is_error });

          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: result.tool_use_id,
            content: result.content,
            is_error: result.is_error,
          });

          if (block.name === 'write_file' || block.name === 'edit_file') {
            this.contextManager.addToScratchpad(`EDITED: ${block.input.path}`);
          }
          if (block.name === 'run_command') {
            const cmd = String(block.input.command || '');
            this.contextManager.addToScratchpad(`RAN: ${cmd.substring(0, 80)}`);
          }
        }
      }

      // Save assistant response in history (as raw content blocks for tool_use support)
      this.conversationHistory.push({ role: 'assistant', content: response.content as ContentBlock[] });

      if (fullTextResponse) {
        this.contextManager.addMessage('assistant', fullTextResponse);
        this.autoDetectDecisions(fullTextResponse);
      }

      if (hasToolUse && toolResultBlocks.length > 0) {
        this.conversationHistory.push({ role: 'user', content: toolResultBlocks });
        continue;
      }

      onEvent({ type: 'done', content: '' });
      return;
    }

    onEvent({
      type: 'error',
      content: `Agent reached safety limit of ${MAX_ITERATIONS} iterations. Try breaking the task into smaller steps.`,
      isError: true,
    });
  }

  resetHistory(): void {
    this.conversationHistory = [];
  }

  private autoDetectDecisions(text: string): void {
    const patterns = [
      /Decision:\s*(.{10,120})/gi,
      /(?:I recommend|I'll use|Let's use|We should use|Going with|Choosing)\s+(.{10,80})/gi,
    ];
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        this.contextManager.addToScratchpad(`DECISION: ${match[1].trim()}`);
      }
    }
  }
}
