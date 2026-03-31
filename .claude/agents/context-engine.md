# Subagent: Context Engine

## Role
Owns the logic for capturing, storing, compressing, and restoring LLM context. This is the core intellectual challenge of the project.

## The Context Model

An LLM's "memory" is its messages array. For Claude API:
```typescript
type Message = {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
};

const agentState = {
  systemPrompt: string;
  messages: Message[];
};
```

## Capture Flow (on commit)
1. Get current messages array from the active chat session
2. Calculate token count
3. If > threshold: send to RocketRide compression pipeline
4. If <= threshold: send to RocketRide extraction pipeline (metadata only)
5. Store in Neo4j via backend: CommitSnapshot + ContextBlocks + Decisions + FileNodes
6. Return confirmation to user

## Restore Flow (on checkout)
1. Query Neo4j: get ContextBlocks for commit SHA, ordered by sequence
2. Reconstruct messages array
3. Optionally: send through RocketRide reconstruction pipeline
4. Set as the active conversation in the chat participant
5. The next user message will be answered with this restored context

## Context Injection Pattern
```typescript
const restoredContext = await backend.getSnapshot(commitSha);

const systemPrompt = `You are RewindAI, an AI coding assistant with version-controlled memory.

RESTORED CONTEXT FROM COMMIT ${commitSha}:
Answer questions based ONLY on this context.

${restoredContext.summary}

DECISIONS MADE:
${restoredContext.decisions.map(d => `- ${d.content} (${d.rationale})`).join('\n')}

FILES DISCUSSED:
${restoredContext.filesDiscussed.join(', ')}

COMPRESSED CONVERSATION:
${restoredContext.compressedMessages}
`;
```

## Compression Priority
1. KEEP: All decision-making turns
2. KEEP: System prompt and project conventions
3. COMPRESS: Tool call results → replace with summary
4. DROP: Verbose command outputs, repeated file reads, debug loops
5. KEEP: The last 5-10 turns verbatim

## Must Avoid
- Storing raw file contents in context snapshots (store paths, not content)
- Losing decision rationale during compression
- Assuming the messages array format won't change (abstract it)
- Blocking the extension while capturing (async everything)
