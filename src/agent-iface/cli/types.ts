export interface ParsedArgs {
  command: string
  subcommand?: string
  flags: Record<string, string | string[] | boolean | number>
  positional: string[]
}

export interface CLIResult {
  exitCode: number
  output: string
}
