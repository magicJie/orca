/** Shared by orca-omp-native-chat.ts and orca-omp-native-chat-notify.ts: identical inline code,
 *  no Orca imports — each generated extension must stay self-contained for OMP's loader.
 *
 *  Activation mirrors OMP's own dispatch (cli-commands resolveCliArgv / leadingSubcommandIndex,
 *  cli/flag-tables flagConsumesValue): the first positional after skipping global flags and their
 *  values is the dispatched subcommand, so `--profile work acp` is ACP while a flag value
 *  (`--session-dir acp`) or another subcommand (`launch --mode rpc --session-dir acp`) is not.
 *  `--acp-terminal-auth` turns even a real `acp` dispatch into the interactive TUI, so it is
 *  excluded anywhere in argv. */
export function getOmpAcpModeSourceLines(): string[] {
  return [
    '  // Managed extensions also load in TUI/RPC sessions; activate only in real ACP mode.',
    '  const orcaAcpArgs = process.argv.slice(1)',
    '  const orcaAcpValueFlags = new Set(',
    '    "--alias --profile --approval-mode --config --cwd --extension --goal --max-cost --max-time".split(" ")',
    '      .concat(',
    '        "--mode --model --models --plan --plan-yolo-into --plugin-dir --prewalk-into --prompt-cache-key".split(" "),',
    '        "--provider --provider-session-id --service-tier --session-dir --skills --smol --slow".split(" "),',
    '        "--system-prompt --system-prompt-template --append-system-prompt --thinking --tools --warn-cost".split(" "),',
    '        "--api-key --export --fork --add-dir --hook --trusted-extension -e".split(" "),',
    '      )',
    '  )',
    '  const orcaAcpOptionalFlags = new Set(["--resume", "-r", "--restore", "--session"])',
    '  const orcaAcpValuelessFlags = new Set(',
    '    "--help --version --allow-home --continue --from-claude --from-codex --no-session --no-tools --no-lsp --no-pty".split(" ").concat(',
    '      "--hide-thinking --advisor --wait-async --external-thinking --prewalk --no-prewalk --plan-yolo --print".split(" "),',
    '      "--print-thoughts --no-extensions --no-skills --no-rules --no-context-files --no-title --no-ui --auto-approve --yolo".split(" "),',
    '    )',
    '  )',
    '  const isAcp = (() => {',
    '    // Terminal auth flips ACP into its interactive TUI, wherever the flag lands.',
    '    const terminalAuth = orcaAcpArgs.includes("--acp-terminal-auth")',
    '    for (let i = 0; i < orcaAcpArgs.length; i++) {',
    '      const arg = orcaAcpArgs[i]',
    '      if (arg === "--") return false',
    '      if (!arg.startsWith("-")) {',
    '        // A node/bun script path sits between the runtime and user argv; skip it.',
    '        if (i === 0 && /[\\\\/]|\\.(?:[cm]?js|ts|bun)$/.test(arg)) continue',
    '        return arg === "acp" && !terminalAuth',
    '      }',
    '      if (arg.includes("=")) continue',
    '      if (orcaAcpValueFlags.has(arg)) { i += 1; continue }',
    '      if (orcaAcpValuelessFlags.has(arg)) continue',
    '      if (orcaAcpOptionalFlags.has(arg) || arg.startsWith("--")) {',
    '        const next = orcaAcpArgs[i + 1]',
    '        if (next !== undefined && !next.startsWith("-")) i += 1',
    '      }',
    '    }',
    '    return false',
    '  })()'
  ]
}
