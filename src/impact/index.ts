export interface ImpactGraph {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

export interface ImpactEstimate {
  ticketId: string;
  affectedPaths: string[];
  dependencyPaths: string[];
  overlapsWith: string[];
}
