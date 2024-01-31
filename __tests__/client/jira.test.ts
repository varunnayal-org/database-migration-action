/* eslint-disable @typescript-eslint/no-explicit-any */

import Client from '../../src/client/jira'
import { Config } from '../../src/types.jira'
import factory from '../../src/factory'

// Mock JiraApi
jest.mock('jira-client', () => {
  return jest.fn().mockImplementation(() => ({
    addComment: jest.fn(),
    searchJira: jest.fn()
  }))
})

describe('JiraApi', () => {
  function getJiraConfig(): Config {
    return {
      host: 'https://test.atlassian.net',
      project: 'TEST',
      label: 'db-migration',
      issueType: 'Task',
      approvalStatus: 'DONE',
      fields: {
        pr: 'customfield_1',
        prLabel: 'GithHub PR Link',
        repo: 'customfield_2',
        repoLabel: 'Code Repository Link',
        driApprovals: ['customfield_3']
      },
      schemaDriftLabel: 'db-schema-drift',
      schemaDriftIssueType: 'Bug',
      doneValue: 'Done'
    }
  }

  let config: Config
  let mockSearchJira: jest.SpyInstance
  let mockCreateIssue: jest.SpyInstance
  let mockAddComment: jest.SpyInstance
  let mockJiraApi: any
  beforeEach(() => {
    jest.clearAllMocks()
    config = getJiraConfig()
    mockSearchJira = jest.fn()
    mockCreateIssue = jest.fn()
    mockAddComment = jest.fn()
    mockJiraApi = {
      searchJira: mockSearchJira,
      addNewIssue: mockCreateIssue,
      addComment: mockAddComment
    }
  })

  describe('constructor', () => {
    beforeEach(() => {
      process.env.INPUT_JIRA_USERNAME = 'user'
      process.env.INPUT_JIRA_PASSWORD = 'pass'
    })
    afterAll(() => {
      delete process.env.INPUT_JIRA_USERNAME
      delete process.env.INPUT_JIRA_PASSWORD
    })

    describe('required fields', () => {
      it('should error when username is missing', () => {
        delete process.env.INPUT_JIRA_USERNAME
        expect(() => factory.getJira({ ...config })).toThrow('Jira config missing username')
      })
      it('should error when password is missing', () => {
        delete process.env.INPUT_JIRA_PASSWORD
        expect(() => factory.getJira({ ...config })).toThrow('Jira config missing password')
      })
      it('should error when project is missing', () => {
        expect(() => factory.getJira({ ...config, project: '' })).toThrow('Jira config missing project')
      })
    })

    it('should build from env', () => {
      process.env.INPUT_JIRA_USERNAME = 'user'
      process.env.INPUT_JIRA_PASSWORD = 'pass'
      const client = factory.getJira(config)
      expect(client).toBeDefined()
    })
    it('should return null', () => {
      expect(factory.getJira()).toBeNull()
    })
  })

  it('should add comment', async () => {
    const jira = new Client(mockJiraApi, config)

    mockAddComment.mockResolvedValue({
      id: 1,
      self: 'http://example.com/comment/1',
      body: 'Test Comment'
    })

    const result = await jira.addComment('1', 'Test Comment')

    expect(result).toEqual({
      id: 1,
      self: 'http://example.com/comment/1',
      body: 'Test Comment'
    })
    expect(mockAddComment).toHaveBeenCalledWith('1', 'Test Comment')
  })

  describe('findIssue', () => {
    let mockSearchResponse: any
    let prLink: string
    beforeEach(() => {
      prLink = 'http://example.com/repo/pulls/1'

      mockSearchResponse = {
        issues: [
          {
            id: 1,
            key: 'KEY-1',
            self: 'http://example.com/issue/1',
            fields: {}
          }
        ]
      }
    })
    it('should find issue', async () => {
      const jira = new Client(mockJiraApi, config)

      mockSearchJira.mockResolvedValue(mockSearchResponse)

      const result = await jira.findIssue(prLink)

      expect(result).toEqual(mockSearchResponse.issues[0])
      expect(mockSearchJira).toHaveBeenCalledWith(
        `project="${config.project}" AND "${config.fields.prLabel}" = "${prLink}"`,
        { maxResults: 2 }
      )
    })

    it('should find issue from pr field if label field is missing', async () => {
      config.fields.prLabel = ''
      const jira = new Client(mockJiraApi, config)

      mockSearchJira.mockResolvedValue(mockSearchResponse)

      const result = await jira.findIssue(prLink)

      expect(result).toEqual(mockSearchResponse.issues[0])
      expect(mockSearchJira).toHaveBeenCalledWith(
        `project="${config.project}" AND "${config.fields.pr}" = "${prLink}"`,
        { maxResults: 2 }
      )
    })

    it('should return null if issue is not found', async () => {
      const jira = new Client(mockJiraApi, config)

      mockSearchResponse.issues = []
      mockSearchJira.mockResolvedValue(mockSearchResponse)

      const result = await jira.findIssue(prLink)

      expect(result).toBeNull()
      expect(mockSearchJira).toHaveBeenCalledWith(
        `project="${config.project}" AND "${config.fields.prLabel}" = "${prLink}"`,
        { maxResults: 2 }
      )
    })

    it('should throw error if more than one issue is found for same pr', async () => {
      const jira = new Client(mockJiraApi, config)
      const searchText = `project="${config.project}" AND "${config.fields.prLabel}" = "${prLink}"`

      mockSearchResponse.issues.push({
        id: 2,
        key: 'KEY-2',
        self: 'http://example.com/issue/2',
        fields: {}
      })
      mockSearchJira.mockResolvedValue(mockSearchResponse)

      await expect(jira.findIssue(prLink)).rejects.toThrow(`Found multiple tickets for ${searchText}`)
      expect(mockSearchJira).toHaveBeenCalledWith(searchText, { maxResults: 2 })
    })
  })

  describe('findSchemaDriftIssue', () => {
    let mockSearchResponse: any
    beforeEach(() => {
      mockSearchResponse = {
        issues: [
          {
            id: 1,
            key: 'KEY-1',
            self: 'http://example.com/issue/1',
            fields: {}
          }
        ]
      }
    })

    it('should find issue', async () => {
      const jira = new Client(mockJiraApi, config)

      mockSearchJira.mockResolvedValue(mockSearchResponse)

      const result = await jira.findSchemaDriftIssue('https://example.com/org/repo', config.doneValue)

      expect(result).toEqual(mockSearchResponse.issues[0])
      expect(mockSearchJira).toHaveBeenCalledWith(
        `project="TEST" AND "labels" = "db-schema-drift" AND "Code Repository Link" = "https://example.com/org/repo" AND status != "Done"`,
        { maxResults: 2 }
      )
    })
  })

  describe('createIssue', () => {
    let crateJiraTicketParams: any
    beforeEach(() => {
      crateJiraTicketParams = {
        fields: {
          project: {
            key: 'TEST'
          },
          summary: 'http://example.com/repo/pulls/1',
          description: 'Test Description',
          issuetype: {
            name: 'Task'
          },
          labels: ['db-migration'],
          customfield_1: 'http://example.com/repo/pulls/1',
          customfield_2: 'http://example.com/repo'
        }
      }
    })
    it('should create issue', async () => {
      const jira = new Client(mockJiraApi, config)

      mockCreateIssue.mockResolvedValue({
        id: 1,
        key: 'KEY-1',
        self: 'http://example.com/issue/1',
        fields: {}
      })

      const result = await jira.createIssue({
        prNumber: 1,
        prLink: 'http://example.com/repo/pulls/1',
        repoLink: 'http://example.com/repo',
        description: 'Test Description',
        assigneeName: undefined
      })

      expect(result).toEqual({
        id: 1,
        key: 'KEY-1',
        self: 'http://example.com/issue/1',
        fields: {}
      })
      expect(mockCreateIssue).toHaveBeenCalledWith(crateJiraTicketParams)
    })

    it('should create schema drift issue', async () => {
      const jira = new Client(mockJiraApi, config)

      mockCreateIssue.mockResolvedValue({
        id: 1,
        key: 'KEY-1',
        self: 'http://example.com/issue/1',
        fields: {}
      })

      const result = await jira.createIssue({
        isSchemaDrift: true,
        repoLink: 'http://example.com/repo',
        description: 'Schema drift description'
      })

      expect(result).toEqual({
        id: 1,
        key: 'KEY-1',
        self: 'http://example.com/issue/1',
        fields: {}
      })
      expect(mockCreateIssue).toHaveBeenCalledWith({
        fields: {
          project: {
            key: 'TEST'
          },
          summary: 'http://example.com/repo',
          description: 'Schema drift description',
          issuetype: {
            name: 'Bug'
          },
          labels: ['db-migration', 'db-schema-drift'],
          customfield_2: 'http://example.com/repo'
        }
      })
    })

    it('should set assignee', async () => {
      crateJiraTicketParams.fields.assignee = {
        name: 'user'
      }

      const jira = new Client(mockJiraApi, config)

      mockCreateIssue.mockResolvedValue({
        id: 1,
        key: 'KEY-1',
        self: 'http://example.com/issue/1',
        fields: {}
      })

      const result = await jira.createIssue({
        prNumber: 1,
        prLink: 'http://example.com/repo/pulls/1',
        repoLink: 'http://example.com/repo',
        description: 'Test Description',
        assigneeName: 'user'
      })

      expect(result).toEqual({
        id: 1,
        key: 'KEY-1',
        self: 'http://example.com/issue/1',
        fields: {}
      })
      expect(mockCreateIssue).toHaveBeenCalledWith(crateJiraTicketParams)
    })
  })
})
