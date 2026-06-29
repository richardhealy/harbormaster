/** Linear API client — stub for M7 (Linear + provenance milestone) */

export interface LinearTicket {
  id: string
  identifier: string
  title: string
  state: {
    id: string
    name: string
    type: string
  }
  priority: number
  labels: { id: string; name: string }[]
  assignee?: { id: string; name: string }
}

export class LinearClient {
  private readonly apiKey: string
  private readonly baseUrl = 'https://api.linear.app/graphql'

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /** Fetch a single ticket by its identifier (e.g. "ENG-123"). Stub for M7. */
  async getTicket(_identifier: string): Promise<LinearTicket | null> {
    void this.baseUrl
    void this.apiKey
    return null
  }

  /** Update a ticket's status. Stub for M7. */
  async updateTicketStatus(_identifier: string, _statusId: string): Promise<void> {
    void this.apiKey
  }
}
