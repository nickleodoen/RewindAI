/**
 * Multi-provider LLM client for RewindAI.
 * Supports Anthropic Claude and OpenAI GPT with unified tool-calling interface.
 * Uses raw fetch() — no SDK dependencies.
 */

export interface LLMConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: string | any[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: Record<string, any>;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: string; // 'end_turn' | 'tool_use'
}

export class LLMClient {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async sendRequest(
    systemPrompt: string,
    messages: LLMMessage[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: any[],
  ): Promise<LLMResponse> {
    switch (this.config.provider) {
      case 'anthropic':
        return this.callAnthropic(systemPrompt, messages, tools);
      case 'openai':
        return this.callOpenAI(systemPrompt, messages, tools);
      default:
        throw new Error(
          `Unsupported provider: "${this.config.provider}". ` +
          `Set rewindai.provider to "anthropic" or "openai" in VS Code Settings.`
        );
    }
  }

  // ── Anthropic Claude API ──

  private async callAnthropic(
    systemPrompt: string,
    messages: LLMMessage[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: any[],
  ): Promise<LLMResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model || 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: systemPrompt,
        messages,
        tools,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid Anthropic API key. Check your rewindai.apiKey setting.');
      }
      if (response.status === 429) {
        throw new Error('Rate limited by Anthropic. Wait a moment and try again.');
      }
      if (response.status === 400 && errorBody.includes('credit')) {
        throw new Error('Anthropic API billing issue. Add credits at console.anthropic.com.');
      }
      throw new Error(`Anthropic API error (${response.status}): ${errorBody.slice(0, 300)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: (data.content || []).map((block: any): ContentBlock => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        }
        if (block.type === 'tool_use') {
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        }
        return { type: 'text', text: JSON.stringify(block) };
      }),
      stopReason: data.stop_reason || 'end_turn',
    };
  }

  // ── OpenAI GPT API ──

  private async callOpenAI(
    systemPrompt: string,
    messages: LLMMessage[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: any[],
  ): Promise<LLMResponse> {
    // Convert Anthropic tool format → OpenAI function format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openaiTools = tools.map((t: any) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    // Convert messages to OpenAI format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openaiMessages: any[] = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        openaiMessages.push({ role: msg.role, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Handle tool results and tool_use blocks
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolUseBlocks = msg.content.filter((b: any) => b.type === 'tool_use');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResultBlocks = msg.content.filter((b: any) => b.type === 'tool_result');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textBlocks = msg.content.filter((b: any) => b.type === 'text');

        if (msg.role === 'assistant' && toolUseBlocks.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const textParts = textBlocks.map((b: any) => b.text).join('');
          openaiMessages.push({
            role: 'assistant',
            content: textParts || null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tool_calls: toolUseBlocks.map((tc: any) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.input),
              },
            })),
          });
        }

        // Tool result blocks become separate "tool" role messages
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const block of toolResultBlocks) {
          openaiMessages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          });
        }

        // Plain text from user messages with mixed content
        if (msg.role === 'user' && textBlocks.length > 0 && toolResultBlocks.length === 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          openaiMessages.push({ role: 'user', content: textBlocks.map((b: any) => b.text).join('') });
        }
      }
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model || 'gpt-4o',
        messages: openaiMessages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid OpenAI API key. Check your rewindai.apiKey setting.');
      }
      if (response.status === 429) {
        throw new Error('Rate limited by OpenAI. Wait a moment and try again.');
      }
      throw new Error(`OpenAI API error (${response.status}): ${errorBody.slice(0, 300)}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('Empty response from OpenAI. The model may be overloaded.');
    }

    const content: ContentBlock[] = [];
    if (choice.message?.content) {
      content.push({ type: 'text', text: choice.message.content });
    }
    if (choice.message?.tool_calls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || '{}'),
        });
      }
    }

    return {
      content,
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
    };
  }
}
