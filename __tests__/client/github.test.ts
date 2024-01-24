/* eslint-disable @typescript-eslint/no-explicit-any */

import * as core from '@actions/core'
import * as github from '@actions/github'
import factory from '../../src/factory'
import Client from '../../src/client/github'
import { GHClient } from '../../src/types.gha'

let getInputMock: jest.SpyInstance

describe('github client', () => {
  function mockOctokit(graphqlMock?: jest.Mock, issueMock?: any, pullMocks?: any): any {
    return {
      graphql: graphqlMock || jest.fn(),
      rest: {
        issues: {
          createComment: jest.fn(),
          updateComment: jest.fn(),
          addLabels: jest.fn(),
          ...issueMock
        },
        pulls: {
          get: jest.fn(),
          listFiles: jest.fn(),
          update: jest.fn(),
          ...pullMocks
        }
      }
    }
  }

  jest.mock('@actions/github', () => ({
    getOctokit: jest.fn().mockImplementation(() => mockOctokit())
  }))

  function getClient(): GHClient {
    const client = factory.getGithub()
    client.setOrg('orgName', 'orgOwner', 'repoName')
    return client
  }

  beforeEach(() => {
    jest.clearAllMocks()
    getInputMock = jest.spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'repo_token') {
        return 'token'
      } else if (name === 'debug') {
        return 'true'
      }
      throw new Error(`Unknown input ${name}`)
    })

    jest.spyOn(github, 'getOctokit').mockImplementation()
  })

  afterEach(() => {
    delete process.env.PR_DETAILS
    delete process.env.PR_CHANGED_FILES
  })

  describe('constructor', () => {
    it('should return github client', () => {
      const client = factory.getGithub()

      expect(client).toBeInstanceOf(Client)
      expect(getInputMock).toHaveBeenCalledTimes(2)
    })

    it('should throw error if no token configured', () => {
      const getInputMockFn = getInputMock.mockImplementation((name: string) => {
        if (name === 'repo_token') {
          return ''
        } else if (name === 'debug') {
          return 'true'
        }
        throw new Error(`Unknown input ${name}`)
      })

      expect(() => factory.getGithub()).toThrow('Input repo_token is not set')
      expect(getInputMockFn).toHaveBeenCalledTimes(1)
    })
  })

  it('should get users by team', async () => {
    const teams = ['teamA', 'teamB', 'teamC', 'teamD']
    const expectedResponse = {
      teamA: ['userA', 'userB'],
      teamB: ['userA', 'userC', 'userC'],
      teamC: ['userD', 'userE', 'userF'],
      teamD: []
    }

    const mockGraphql = jest.fn().mockResolvedValue({
      organization: {
        team0: {
          name: teams[0],
          members: {
            nodes: expectedResponse.teamA.map(login => ({ login }))
          }
        },
        team1: {
          name: teams[1],
          members: {
            nodes: expectedResponse.teamB.map(login => ({ login }))
          }
        },
        team2: {
          name: teams[2],
          members: {
            nodes: expectedResponse.teamC.map(login => ({ login }))
          }
        }
      }
    })

    ;(github.getOctokit as jest.Mock).mockImplementation(() => mockOctokit(mockGraphql))

    const fetchCount = 10

    const response = await getClient().getUserForTeams(teams, fetchCount)

    expect(response).toEqual(expectedResponse)
    expect(mockGraphql).toHaveBeenCalledTimes(1)
    expect(mockGraphql).toHaveBeenCalledWith(expect.anything(), {
      orgLogin: 'orgName',
      team0: teams[0],
      team1: teams[1],
      team2: teams[2],
      team3: teams[3],
      fetchCount
    })
  })

  it('should get pr approved user list', async () => {
    const prNumber = 123
    const expectedResponse = ['userA', 'userB', 'userC']

    const mockGraphql = jest.fn().mockResolvedValue({
      repository: {
        pullRequest: {
          reviews: {
            nodes: expectedResponse.map(login => ({ author: { login } }))
          }
        }
      }
    })

    ;(github.getOctokit as jest.Mock).mockImplementation(() => mockOctokit(mockGraphql))

    const response = await getClient().getPullRequestApprovedUserList(prNumber)

    expect(response).toEqual(expectedResponse)
    expect(mockGraphql).toHaveBeenCalledTimes(1)
    expect(mockGraphql).toHaveBeenCalledWith(expect.anything(), {
      owner: 'orgOwner',
      repoName: 'repoName',
      prNumber
    })
  })

  it('should add comment', async () => {
    const prNumber = 123
    const message = 'message'
    const expectedResponse = { id: 123 }

    const mockCreateComment = jest.fn().mockResolvedValue({ data: expectedResponse })
    ;(github.getOctokit as jest.Mock).mockImplementation(() =>
      mockOctokit(undefined, { createComment: mockCreateComment })
    )

    const response = await getClient().addComment(prNumber, message)

    expect(response).toEqual(expectedResponse)
    expect(mockCreateComment).toHaveBeenCalledTimes(1)
    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'orgOwner',
      repo: 'repoName',
      issue_number: prNumber,
      body: message
    })
  })

  it('should update comment', async () => {
    const commentId = 123
    const message = 'message'
    const expectedResponse = { id: 123 }

    const mockUpdateComment = jest.fn().mockResolvedValue({ data: expectedResponse })
    ;(github.getOctokit as jest.Mock).mockImplementation(() =>
      mockOctokit(undefined, { updateComment: mockUpdateComment })
    )

    const response = await getClient().updateComment(commentId, message)

    expect(response).toEqual(expectedResponse)
    expect(mockUpdateComment).toHaveBeenCalledTimes(1)
    expect(mockUpdateComment).toHaveBeenCalledWith({
      owner: 'orgOwner',
      repo: 'repoName',
      comment_id: commentId,
      body: message
    })
  })

  it('should add label', async () => {
    const prNumber = 123
    const labels = ['label1', 'label2']
    const expectedResponse = { id: 123 }

    const mockAddLabels = jest.fn().mockResolvedValue({ data: expectedResponse })
    ;(github.getOctokit as jest.Mock).mockImplementation(() => mockOctokit(undefined, { addLabels: mockAddLabels }))

    const response = await getClient().addLabel(prNumber, labels)

    expect(response).toEqual(expectedResponse)
    expect(mockAddLabels).toHaveBeenCalledTimes(1)
    expect(mockAddLabels).toHaveBeenCalledWith({
      owner: 'orgOwner',
      repo: 'repoName',
      issue_number: prNumber,
      labels
    })
  })

  describe('getPRInformation', () => {
    let expectedResponse: any
    let apiData: any

    beforeEach(() => {
      expectedResponse = {
        defaultBranchRef: { name: 'master' },
        pullRequest: {
          baseRef: {
            name: 'release',
            repository: {
              id: '11111',
              name: 'repoName',
              url: 'https://githu.com',
              primaryLanguage: { name: 'Go' },
              owner: { login: 'userA' }
            }
          }
        }
      }
      apiData = {
        base: {
          ref: 'release',
          repo: {
            id: '11111',
            name: 'repoName',
            owner: { login: 'userA' },
            html_url: 'https://githu.com',
            language: 'Go',
            default_branch: 'master'
          }
        }
      }
    })

    it('should get pr information', async () => {
      const prNumber = 123

      const mockGet = jest.fn().mockResolvedValue({ data: apiData })
      ;(github.getOctokit as jest.Mock).mockImplementation(() => mockOctokit(undefined, undefined, { get: mockGet }))

      const response = await getClient().getPRInformation(prNumber)

      expect(response).toEqual(expectedResponse)
      expect(mockGet).toHaveBeenCalledTimes(1)
      expect(mockGet).toHaveBeenCalledWith({
        owner: 'orgOwner',
        repo: 'repoName',
        pull_number: prNumber
      })
    })

    it('should get pr information from env', async () => {
      const prNumber = 123
      process.env.PR_DETAILS = JSON.stringify(apiData)

      const mockGet = jest.fn()
      ;(github.getOctokit as jest.Mock).mockImplementation(() => mockOctokit(undefined, undefined, { get: mockGet }))

      const response = await getClient().getPRInformation(prNumber)

      expect(response).toEqual(expectedResponse)
      expect(mockGet).toHaveBeenCalledTimes(0)
    })
  })

  describe('getChangedFiles', () => {
    let expectedResponse: string[]
    let apiData: any
    beforeEach(() => {
      expectedResponse = [
        'Makefile',
        'migrations/0001.sql',
        'migrations/0002.sql',
        '.github/workflows/db-migration.yaml'
      ]
      apiData = [
        { filename: 'Makefile', status: 'added' },
        { filename: 'migrations/0001.sql', status: 'modified' },
        { filename: 'migrations/0002.sql', status: 'renamed' },
        { filename: '.github/workflows/db-migration.yaml', status: 'copied' },
        { filename: 'migrations/0003.sql', status: 'unknown' }
      ]
    })

    it('should get changed files', async () => {
      const prNumber = 123

      const mockListFiles = jest.fn().mockResolvedValue({ data: apiData })
      ;(github.getOctokit as jest.Mock).mockImplementation(() =>
        mockOctokit(undefined, undefined, { listFiles: mockListFiles })
      )

      const response = await getClient().getChangedFiles(prNumber)

      expect(response).toEqual(expectedResponse)
      expect(mockListFiles).toHaveBeenCalledTimes(1)
      expect(mockListFiles).toHaveBeenCalledWith({
        owner: 'orgOwner',
        repo: 'repoName',
        pull_number: prNumber,
        per_page: 3000
      })
    })

    it('should get changed files from env', async () => {
      const prNumber = 123
      process.env.PR_CHANGED_FILES = JSON.stringify(expectedResponse)

      const mockListFiles = jest.fn()
      ;(github.getOctokit as jest.Mock).mockImplementation(() =>
        mockOctokit(undefined, undefined, { listFiles: mockListFiles })
      )

      const response = await getClient().getChangedFiles(prNumber)

      expect(response).toEqual(expectedResponse)
      expect(mockListFiles).toHaveBeenCalledTimes(0)
    })
  })

  it('should close pr', async () => {
    const prNumber = 123
    const expectedResponse = { id: 123 }

    const mockUpdate = jest.fn().mockResolvedValue({ data: expectedResponse })
    ;(github.getOctokit as jest.Mock).mockImplementation(() =>
      mockOctokit(undefined, undefined, { update: mockUpdate })
    )

    const response = await getClient().closePR(prNumber, 'message')

    expect(response).toEqual(expectedResponse)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({
      owner: 'orgOwner',
      repo: 'repoName',
      pull_number: prNumber,
      state: 'closed',
      body: 'message'
    })
  })

  it('should throw error if response is empty', async () => {
    const prNumber = 123
    const message = 'message'

    const mockCreateComment = jest.fn().mockResolvedValue(undefined)
    ;(github.getOctokit as jest.Mock).mockImplementation(() =>
      mockOctokit(undefined, { createComment: mockCreateComment })
    )

    await expect(getClient().addComment(prNumber, message)).rejects.toThrow('GitHub API Failed(Add comment)')

    expect(mockCreateComment).toHaveBeenCalledTimes(1)
    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'orgOwner',
      repo: 'repoName',
      issue_number: prNumber,
      body: message
    })
  })
})
