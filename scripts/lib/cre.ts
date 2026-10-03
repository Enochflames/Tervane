// Runs `cre workflow simulate` for the settle workflow and extracts the result (tx hash) and debug log lines.
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ROOT } from './chain'

export interface SimResult { ok: boolean; result: string; userLogs: string[]; output: string }

export async function simulate(opts: { trigger: 0 | 1; txHash?: string; eventIndex?: number; broadcast?: boolean }): Promise<SimResult> {
  const args = ['workflow', 'simulate', 'settle', '--target', 'staging-settings', '--non-interactive', '--trigger-index', String(opts.trigger)]
  if (opts.txHash) args.push('--evm-tx-hash', opts.txHash, '--evm-event-index', String(opts.eventIndex ?? 0))
  if (opts.broadcast) args.push('--broadcast')
  const env = { ...process.env, PATH: `${join(homedir(), '.cre/bin')}:${join(homedir(), '.bun/bin')}:${process.env.PATH}` }
  const p = Bun.spawn(['cre', ...args], { cwd: join(ROOT, 'settler'), env, stdout: 'pipe', stderr: 'pipe' })
  const output = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text())
  await p.exited
  const userLogs = output.split('\n').filter((l) => l.includes('[USER LOG]')).map((l) => l.replace(/^.*\[USER LOG\]\s*/, ''))
  const m = output.match(/Workflow Simulation Result:\s*\n\s*"([^"]+)"/)
  return { ok: p.exitCode === 0 && !!m, result: m?.[1] ?? '', userLogs, output }
}
