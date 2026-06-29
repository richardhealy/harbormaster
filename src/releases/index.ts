export interface ReleaseManifest {
  version: string;
  tickets: string[];
  notes: string;
  createdAt: Date;
  freezeWindows: Array<{ start: Date; end: Date }>;
}

export interface ReleaseFreeze {
  start: Date;
  end: Date;
  reason: string;
}
