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
    core.error(`Processing failed; ${error}`)
    console.log(error.stack)
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
    throw error
  }
}

main()
