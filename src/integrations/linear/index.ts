export interface LinearTicket {
  id: string;
  title: string;
  state: string;
  assignee?: string;
  labels: string[];
}

export interface LinearReleaseManifest {
  version: string;
  tickets: LinearTicket[];
  freezeWindows: Array<{ start: Date; end: Date }>;
}
