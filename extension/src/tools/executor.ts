import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { ContextManager } from '../context/manager';

export interface ToolCall {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

/**
 * Executes tools requested by the LLM during the agentic loop.
 * 7 tools: read_file, write_file, edit_file, run_command, list_files, search_files, delete_file.
 */
export class ToolExecutor {
  constructor(
    private workspaceRoot: string,
    private contextManager: ContextManager,
  ) {}

  /**
   * Tool definitions in Anthropic format. Sent to the LLM so it knows what's available.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getToolDefinitions(): Array<{ name: string; description: string; input_schema: any }> {
    return [
      {
        name: 'read_file',
        description: 'Read the full contents of a file in the workspace. Returns the file contents as a string. Always read a file before editing it.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to the workspace root.' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Create a new file or completely overwrite an existing file. For small targeted changes, prefer edit_file instead.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace root. Parent directories created automatically.' },
            content: { type: 'string', description: 'The complete file content to write.' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'edit_file',
        description: 'Make a targeted edit by finding an exact string and replacing it. old_text must match exactly including whitespace. Always read_file first.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace root.' },
            old_text: { type: 'string', description: 'Exact text to find (character-for-character match).' },
            new_text: { type: 'string', description: 'Text to replace old_text with.' },
          },
          required: ['path', 'old_text', 'new_text'],
        },
      },
      {
        name: 'run_command',
        description: 'Execute a shell command in the workspace directory. Use for: installing packages, running tests, building, checking status, running scripts. 60-second timeout.',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute in the workspace root.' },
          },
          required: ['command'],
        },
      },
      {
        name: 'list_files',
        description: 'List files and directories at a given path. Use to understand project structure before diving into specific files.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path relative to workspace root. Use "" or "." for root.' },
            recursive: { type: 'boolean', description: 'If true, list recursively. Default false.' },
          },
          required: [],
        },
      },
      {
        name: 'search_files',
        description: 'Search for a text pattern across files. Returns matching lines with file paths and line numbers.',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Text or regex pattern to search for.' },
            file_pattern: { type: 'string', description: 'Optional file glob to narrow search. Examples: "*.ts", "src/**/*.tsx".' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'delete_file',
        description: 'Permanently delete a file from the workspace. Cannot be recovered unless tracked by git.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace root.' },
          },
          required: ['path'],
        },
      },
    ];
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const { id, name, input } = toolCall;

    try {
      let content: string;

      switch (name) {
        case 'read_file':
          content = await this.readFile(input.path);
          break;
        case 'write_file':
          content = await this.writeFile(input.path, input.content);
          break;
        case 'edit_file':
          content = await this.editFile(input.path, input.old_text, input.new_text);
          break;
        case 'run_command':
          content = await this.runCommand(input.command);
          break;
        case 'list_files':
          content = await this.listFiles(input.path ?? '', input.recursive ?? false);
          break;
        case 'search_files':
          content = await this.searchFiles(input.pattern, input.file_pattern);
          break;
        case 'delete_file':
          content = await this.deleteFile(input.path);
          break;
        default:
          return { tool_use_id: id, content: `Unknown tool: ${name}`, is_error: true };
      }

      return { tool_use_id: id, content, is_error: false };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { tool_use_id: id, content: `Error executing ${name}: ${msg}`, is_error: true };
    }
  }

  // ── Path resolution ──

  /** Safely resolve a file path, stripping leading slashes and preventing traversal. */
  private resolvePath(filePath: string): string {
    // Strip leading slashes — LLMs sometimes produce absolute-looking paths
    let cleaned = filePath.replace(/^\/+/, '');
    // Normalize and join
    const fullPath = path.join(this.workspaceRoot, cleaned);
    // Prevent path traversal
    if (!fullPath.startsWith(this.workspaceRoot)) {
      throw new Error('Cannot access files outside the workspace.');
    }
    return fullPath;
  }

  // ── Tool implementations ──

  private async readFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      // Help the LLM find the right file by listing the parent directory
      const parentDir = path.dirname(fullPath);
      let hint = '';
      if (fs.existsSync(parentDir)) {
        try {
          const siblings = fs.readdirSync(parentDir).slice(0, 20);
          hint = `\nFiles in ${path.dirname(filePath) || '.'}:\n${siblings.join('\n')}`;
        } catch { /* ignore */ }
      }
      throw new Error(`File not found: ${filePath}. Use list_files to check the correct path.${hint}`);
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      throw new Error(`${filePath} is a directory. Use list_files instead.`);
    }
    if (stat.size > 500_000) {
      throw new Error(`File too large (${(stat.size / 1024).toFixed(0)} KB). Use search_files to find specific content.`);
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    this.contextManager.trackFile(filePath);
    return content;
  }

  private async writeFile(filePath: string, content: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const existed = fs.existsSync(fullPath);
    fs.writeFileSync(fullPath, content, 'utf-8');
    this.contextManager.trackFile(filePath);

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    } catch {
      // Editor might not be available
    }

    const lineCount = content.split('\n').length;
    return `${existed ? 'Updated' : 'Created'} ${filePath} (${lineCount} lines, ${content.length} bytes)`;
  }

  private async editFile(filePath: string, oldText: string, newText: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    let content = fs.readFileSync(fullPath, 'utf-8');
    const index = content.indexOf(oldText);
    if (index === -1) {
      const lines = content.split('\n');
      const preview = lines.slice(0, 30).join('\n');
      throw new Error(
        `Could not find the exact text to replace in ${filePath}. ` +
        `Make sure old_text matches character-for-character including whitespace and newlines. ` +
        `Try using read_file first to see the exact content. ` +
        `File has ${lines.length} lines. First 30 lines:\n${preview}`
      );
    }

    content = content.substring(0, index) + newText + content.substring(index + oldText.length);
    fs.writeFileSync(fullPath, content, 'utf-8');
    this.contextManager.trackFile(filePath);

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    } catch {
      // Ignore editor errors
    }

    return `Edited ${filePath}: replaced ${oldText.length} chars with ${newText.length} chars`;
  }

  private async runCommand(command: string): Promise<string> {
    const blocked = ['rm -rf /', 'rm -rf ~', 'rm -rf *', 'mkfs.', 'dd if=/dev/', ':(){:|:&};:', '> /dev/sda'];
    const cmdLower = command.toLowerCase().trim();
    for (const b of blocked) {
      if (cmdLower.includes(b)) {
        throw new Error(`Command blocked for safety: ${command}`);
      }
    }

    return new Promise<string>((resolve) => {
      exec(
        command,
        {
          cwd: this.workspaceRoot,
          timeout: 60_000,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, FORCE_COLOR: '0' },
        },
        (error, stdout, stderr) => {
          let output = '';
          if (stdout) { output += stdout; }
          if (stderr) { output += (output ? '\n--- stderr ---\n' : '') + stderr; }
          if (error && !output) {
            output = `Command failed with exit code ${error.code}: ${error.message}`;
          }
          if (output.length > 8000) {
            output =
              output.substring(0, 3000) +
              `\n\n... [${output.length - 6000} chars truncated] ...\n\n` +
              output.substring(output.length - 3000);
          }
          resolve(output || '(command completed with no output)');
        },
      );
    });
  }

  private async listFiles(dirPath: string, recursive: boolean): Promise<string> {
    const fullPath = this.resolvePath(dirPath || '.');
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Directory not found: ${dirPath || '.'}`);
    }

    const entries: string[] = [];
    const ignoreDirs = new Set(['.git', 'node_modules', '__pycache__', '.next', '.venv', 'venv', 'dist', 'build', '.rewind']);

    const walk = (dir: string, prefix: string, depth: number): void => {
      if (entries.length >= 300) { return; }
      if (!recursive && depth > 0) { return; }

      let items: fs.Dirent[];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

      items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) { return -1; }
        if (!a.isDirectory() && b.isDirectory()) { return 1; }
        return a.name.localeCompare(b.name);
      });

      for (const item of items) {
        if (item.name.startsWith('.') && item.name !== '.env.example') { continue; }
        if (ignoreDirs.has(item.name)) { continue; }
        const relPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          entries.push(`📁 ${relPath}/`);
          if (recursive) { walk(path.join(dir, item.name), relPath, depth + 1); }
        } else {
          entries.push(`📄 ${relPath}`);
        }
      }
    };

    walk(fullPath, dirPath || '.', 0);

    if (entries.length === 0) { return '(empty directory)'; }
    if (entries.length >= 300) { entries.push('\n... (truncated at 300 entries)'); }
    return entries.join('\n');
  }

  private async searchFiles(pattern: string, filePattern?: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const safePattern = pattern.replace(/'/g, "'\\''");
      const includeFlag = filePattern ? `--include='${filePattern}'` : '';
      const cmd = `grep -rn ${includeFlag} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=__pycache__ --exclude-dir=.rewind '${safePattern}' . 2>/dev/null | head -80`;

      exec(cmd, { cwd: this.workspaceRoot, timeout: 15_000 }, (_error, stdout) => {
        if (!stdout || stdout.trim().length === 0) {
          resolve(`No matches found for "${pattern}"${filePattern ? ` in ${filePattern} files` : ''}.`);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  private async deleteFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    fs.unlinkSync(fullPath);
    return `Deleted: ${filePath}`;
  }
}
