import * as core from '@actions/core'
import { spawn } from 'child_process'
import fs from 'fs'

export type CommentBuilderHandler = (boldText: string, msg?: string) => string

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
      core.debug(`Command: ${[command, ...args.slice(0, -1), '***']}code=${code} output=${output}`)
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
export function globFromList(
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

export { createTempDir, removeDir, cleanDir, getEnv, getInput, exec, readableDate }
