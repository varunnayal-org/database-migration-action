import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import * as core from '@actions/core'
import * as github from '@actions/github'
import { Context } from './types.gha'

function getContext(): Context {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return github.context as any as Context
}

export const hasExtension = (file: string, ext: string): boolean => path.extname(file) === ext
export const hasExtensions = (file: string, exts: string[]): boolean => exts.includes(path.extname(file))

export function getRelativePathForDbDirectory(directory: string): string {
  if (process.env.LOCAL_TESTING_REPO_DIR) {
    return path.relative(process.env.LOCAL_TESTING_REPO_DIR, directory)
  }
  return directory
}

async function cleanDir(dirName: string): Promise<void> {
  try {
    await fs.promises.rm(dirName, { recursive: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (ex: NodeJS.ErrnoException | any) {
    if (ex.code !== 'ENOENT') {
      throw ex
    }
  }
}

async function createTempDir(dirName: string): Promise<string> {
  await fs.promises.mkdir(dirName, { recursive: true })
  return dirName
}

async function removeDir(dirName: string): Promise<void> {
  core.debug(`Removing Dir: ${dirName}`)
  if (dirName) {
    fs.promises.rm(dirName, { recursive: true })
  }
}

function getEnv(envName: string, fromState: NodeJS.ProcessEnv = process.env): string {
  const value = fromState[envName]
  if (typeof value === 'undefined') {
    throw new Error(`Environment variable ${envName} is not set`)
  }
  return value
}

function getInput(name: string, defaultValue?: string): string {
  const value = core.getInput(name)
  if (value !== '') {
    return value
  }
  if (defaultValue === undefined) {
    throw new Error(`Input ${name} is not set`)
  }
  return defaultValue
}

function readableDate(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Calcutta'
  })
}

async function exec(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Spawn the process
    const process = spawn(command, args)

    let output = ''

    // Collect data from stdout
    process.stdout.on('data', data => {
      output += data.toString()
    })

    // Collect data from stderr
    process.stderr.on('data', data => {
      output += data.toString()
    })

    // Handle process errors (e.g., command not found)
    process.on('error', error => {
      reject(error)
    })

    // Resolve the promise when the process exits
    process.on('close', code => {
      output = output.trim()
      if (output.startsWith('"') && output.endsWith('"')) {
        output = output.slice(1, -1)
      }
      core.info(`Command: ${[command, ...args.slice(0, -1), '***'].join(' ')}code=${code} output=${output}`)
      if (code === 0) {
        resolve(output)
      } else {
        reject(new Error(output))
      }
    })
  })
}

/**
 * Filters out files that are not present in the pathPrefixList
 * @param pathPrefixList
 * @param changedFiles
 */
function globFromList(
  migrationDirPathList: string[],
  changedFiles: string[]
): { matched: string[][]; unmatched: string[] } {
  const matched: string[][] = migrationDirPathList.map(() => [])
  const unmatched: string[] = []

  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let fileIdx = 0; fileIdx < changedFiles.length; fileIdx++) {
    const changedFile = changedFiles[fileIdx]
    let matchMigrationDirIdx = -1
    for (let idx = 0; idx < migrationDirPathList.length; idx++) {
      const migrationDirPath = migrationDirPathList[idx]

      if (changedFile.startsWith(migrationDirPath)) {
        matchMigrationDirIdx = idx
        break
      }
    }

    // no match found
    if (matchMigrationDirIdx === -1) {
      unmatched.push(changedFile)
      continue
    }

    matched[matchMigrationDirIdx].push(changedFile)
  }

  return { matched, unmatched }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeWithRetry<T = any>(
  fn: () => Promise<T>,
  errPrefix: string,
  maxRetryCount = 3,
  minWaitMS = 500,
  maxWaitMS = 5000
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let err: any
  for (let i = 1; i <= maxRetryCount; ++i) {
    try {
      return fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ex: any) {
      if (!err) {
        err = ex
      }
      if (i < maxRetryCount) {
        const randomWaitMS = Math.floor(Math.random() * (maxWaitMS - minWaitMS + 1) + minWaitMS)
        setTimeout(() => {}, randomWaitMS)
        continue
      }
    }
  }
  core.error(`${errPrefix} Error: ${err.message}`)
  throw err
}

export {
  getContext,
  createTempDir,
  removeDir,
  cleanDir,
  getEnv,
  getInput,
  exec,
  readableDate,
  globFromList,
  executeWithRetry
}
