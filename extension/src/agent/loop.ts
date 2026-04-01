/**
 * The Agentic Loop — core engine of RewindAI.
 *
 * Orchestrates: User message → LLM → (tool calls → execute → results → LLM)* → final response
 *
 * The loop continues until the LLM responds with only text (no tool_use blocks)
 * or we hit MAX_ITERATIONS. Context is auto-saved on git commit by GitWatcher.
 *
 * After each run, generates a session note (.md) capturing everything that happened.
 */

import { LLMClient, LLMMessage, LLMConfig, ContentBlock } from '../llm/client';
import { ToolExecutor } from '../tools/executor';
import { ContextManager } from '../context/manager';
import { SessionNoteGenerator } from '../context/sessionNotes';
import { SessionCompactor } from '../context/compactor';
import { RocketRideClient } from '../pipelines/rocketrideClient';

const MAX_ITERATIONS = 25;

export interface AgentEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'thinking' | 'done';
  content: string;
  toolName?: string;
  isError?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

const BASE_SYSTEM_PROMPT = `You are RewindAI — an AI coding assistant running inside a VS Code extension. You have tools to read, write, edit files, run commands, and search the codebase.

═══════════════════════════════════════════
CRITICAL RULE — ALWAYS USE TOOLS
═══════════════════════════════════════════
When the user asks you to create, write, build, implement, fix, update, or modify ANY code:
→ You MUST use write_file or edit_file to make changes
→ You MUST NOT just print code in your response
→ WRONG: Showing code in a markdown block and saying "here's the code"
→ RIGHT: Using write_file to create the file, then confirming what you did

If the user says "create a file", "write a function", "add a component", "fix the bug", "implement X":
1. Use write_file (new files) or edit_file (existing files) to make the change
2. Then briefly explain what you did

NEVER output code in markdown blocks as your answer. ALWAYS use tools to write/edit files.
═══════════════════════════════════════════

HOW TO WORK:
1. ALWAYS read a file before editing it. Use read_file first.
2. Use edit_file for targeted changes. Use write_file only for new files or complete rewrites.
3. After making changes, run relevant commands to verify (npm test, npm run build, etc.).
4. When you make a technical decision, state it clearly: "Decision: [what] because [why]"
5. Break complex tasks into steps. Tell the user what you're doing at each step.
6. If something fails, read the error and try a different approach.
7. Be concise — the user reads your responses in a narrow panel.
8. Use list_files to explore the project structure when unsure about paths.
9. All file paths are relative to the workspace root (no leading slash).

ABOUT YOUR MEMORY:
- Your conversation history is tied to git commits
- When the developer commits, everything we've discussed is saved
- When they checkout a different commit, you remember what was discussed at THAT point
- If restored context is provided below, use it for continuity
- If previous conversation history is shown, use it — files mentioned there exist

DO NOT:
- Make changes without reading the file first
- Run dangerous commands (rm -rf, etc.)
- Guess at file contents — always read them
- Write overly long responses
- Output code in markdown blocks instead of using write_file/edit_file`;

export class AgentLoop {
  private llmClient: LLMClient;
  private toolExecutor: ToolExecutor;
  private contextManager: ContextManager;
  private conversationHistory: LLMMessage[] = [];

  constructor(
    config: LLMConfig,
    toolExecutor: ToolExecutor,
    contextManager: ContextManager,
    private workspaceRoot: string,
    private rocketride?: RocketRideClient,
  ) {
    this.llmClient = new LLMClient(config);
    this.toolExecutor = toolExecutor;
    this.contextManager = contextManager;
  }

  /**
   * Run the agent with a user message.
   * Events are emitted via onEvent for the UI to display.
   * After completion, generates a session note .md file.
   */
  async run(userMessage: string, onEvent: AgentEventHandler): Promise<void> {
    // Start session note tracking
    const noteGen = new SessionNoteGenerator(this.workspaceRoot);
    noteGen.startSession();
    noteGen.recordEvent({ type: 'user_message', content: userMessage });
    let fullAssistantText = '';

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

    // Inject only session context relevant to the user's current query
    const sessionContext = noteGen.buildRelevantContext(userMessage, 3);
    if (sessionContext) {
      systemPrompt += '\n\n' + sessionContext;
    }

    // Load previous conversation history from ContextManager (persists across prompts)
    const previousMessages = this.contextManager.getMessages();
    if (this.conversationHistory.length === 0 && previousMessages.length > 0) {
      // Build a condensed history so the LLM knows what happened in prior prompts
      const historyText = previousMessages
        .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
        .map(m => {
          if (m.role === 'tool') { return `[Tool] ${m.content}`; }
          return `[${m.role}]: ${m.content.slice(0, 300)}${m.content.length > 300 ? '...' : ''}`;
        })
        .join('\n');

      if (historyText.length > 0) {
        this.conversationHistory.push({
          role: 'user',
          content: `[Previous conversation history — use this for context, files mentioned here exist]\n${historyText}`,
        });
        this.conversationHistory.push({
          role: 'assistant',
          content: 'Understood. I have context from our previous conversation and will continue from where we left off.',
        });
      }
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
        noteGen.recordEvent({ type: 'error', content: msg, isError: true });
        // Still generate session note on error
        await this.finishSession(noteGen, userMessage, fullAssistantText || `[Error: ${msg}]`);
        return;
      }

      let hasToolUse = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolResultBlocks: any[] = [];

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          fullAssistantText += block.text;
          onEvent({ type: 'text', content: block.text });
          noteGen.recordEvent({ type: 'assistant_text', content: block.text });
        }

        if (block.type === 'tool_use' && block.id && block.name && block.input) {
          hasToolUse = true;

          const inputSummary = JSON.stringify(block.input);
          const truncatedInput = inputSummary.length > 150
            ? inputSummary.substring(0, 150) + '...'
            : inputSummary;

          onEvent({ type: 'tool_call', content: truncatedInput, toolName: block.name });

          // Record tool call for session notes
          noteGen.recordEvent({
            type: 'tool_call',
            content: `${block.name}(${inputSummary.slice(0, 200)})`,
            toolName: block.name,
            toolInput: block.input,
          });

          const result = await this.toolExecutor.execute({
            id: block.id,
            name: block.name,
            input: block.input,
          });

          const displayResult = result.content.length > 500
            ? result.content.substring(0, 500) + '\n... (truncated)'
            : result.content;

          onEvent({ type: 'tool_result', content: displayResult, toolName: block.name, isError: result.is_error });

          // Record tool result for session notes
          noteGen.recordEvent({
            type: 'tool_result',
            content: result.content.slice(0, 500),
            toolName: block.name,
            toolInput: block.input,
            isError: result.is_error,
          });

          // Track file changes for session notes
          if (block.name === 'write_file' || block.name === 'edit_file') {
            noteGen.recordFileChange(block.input.path, block.name === 'write_file' ? 'created' : 'modified');
          }
          if (block.name === 'delete_file') {
            noteGen.recordFileChange(block.input.path, 'deleted');
          }

          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: result.tool_use_id,
            content: result.content,
            is_error: result.is_error,
          });

          // Record tool summary for cross-prompt persistence
          this.contextManager.addToolSummary(
            block.name,
            JSON.stringify(block.input).slice(0, 200),
            result.content.slice(0, 200),
            result.is_error,
          );

          if (block.name === 'write_file' || block.name === 'edit_file') {
            this.contextManager.addToScratchpad(`EDITED: ${block.input.path}`);
          }
          if (block.name === 'run_command') {
            const cmd = String(block.input.command || '');
            this.contextManager.addToScratchpad(`RAN: ${cmd.substring(0, 80)}`);
          }
        }
      }

      this.conversationHistory.push({ role: 'assistant', content: response.content as ContentBlock[] });

      if (fullAssistantText) {
        this.contextManager.addMessage('assistant', fullAssistantText);
        this.autoDetectDecisions(fullAssistantText);
      }

      if (hasToolUse && toolResultBlocks.length > 0) {
        this.conversationHistory.push({ role: 'user', content: toolResultBlocks });
        continue;
      }

      onEvent({ type: 'done', content: '' });

      // Generate session note after successful completion
      await this.finishSession(noteGen, userMessage, fullAssistantText);
      return;
    }

    onEvent({
      type: 'error',
      content: `Agent reached safety limit of ${MAX_ITERATIONS} iterations. Try breaking the task into smaller steps.`,
      isError: true,
    });

    await this.finishSession(noteGen, userMessage, fullAssistantText || '[Max iterations reached]');
  }

  resetHistory(): void {
    this.conversationHistory = [];
  }

  private async finishSession(noteGen: SessionNoteGenerator, userMessage: string, assistantText: string): Promise<void> {
    try {
      const notePath = await noteGen.endSession(userMessage, assistantText);
      console.log(`RewindAI: Session note saved: ${notePath}`);

      // Try RocketRide LLM enrichment (non-blocking — falls back gracefully)
      if (this.rocketride?.isConnected()) {
        try {
          const toolCalls = noteGen.getToolCallSummaries();
          const enriched = await this.rocketride.enrichSessionNote(userMessage, assistantText, toolCalls);
          if (enriched) {
            console.log(`RewindAI: RocketRide enriched session — ${enriched.decisions.length} decisions, ${enriched.insights.length} insights`);
            // Add enriched decisions to scratchpad
            for (const d of enriched.decisions) {
              this.contextManager.addToScratchpad(`DECISION (AI): ${d.content}`);
            }
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log('RewindAI: RocketRide enrichment skipped:', msg);
        }
      }

      const compactor = new SessionCompactor(this.workspaceRoot, 1, this.rocketride);
      if (compactor.shouldCompact()) {
        const compactedPath = await compactor.compact();
        if (compactedPath) {
          console.log(`RewindAI: Compacted session notes: ${compactedPath}`);
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('RewindAI: Failed to save session note:', msg);
    }
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
