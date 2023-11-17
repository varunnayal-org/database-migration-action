import * as core from '@actions/core'
import fs from 'fs'

async function cleanDir(dirName: string): Promise<void> {
  try {
    fs.rmSync(dirName, { recursive: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: NodeJS.ErrnoException | any) {
    if (ex.code !== 'ENOENT') {
      throw ex
    }
  }
}

async function createTempDir(dirName: string): Promise<string> {
  fs.mkdirSync(dirName, { recursive: true })
  return dirName
}

async function removeDir(dirName: string): Promise<void> {
  core.debug(`Removing Dir: ${dirName}`)
  if (dirName) {
    fs.rmSync(dirName, { recursive: true })
  }
}

function getEnv(envName: string, fromState: NodeJS.ProcessEnv = process.env): string {
  const value = fromState[envName]
  if (typeof value === 'undefined') {
    throw new Error(`Environment variable ${envName} is not set`)
  }
  return value
}

export { createTempDir, removeDir, cleanDir, getEnv }
