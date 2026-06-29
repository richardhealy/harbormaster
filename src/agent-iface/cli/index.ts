export interface CliCommand {
  name: string;
  description: string;
  handler: (args: Record<string, unknown>) => Promise<void>;
}
