/**
 * The entrypoint for the action.
 */
import * as core from '@actions/core'
import { run } from './main'

async function main(): Promise<void> {
  try {
    await run()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

main()
