interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * HealthData.gov MCP — wraps HealthData.gov CKAN API (free, no auth)
 *
 * Tools:
 * - search_datasets: search health datasets by keyword
 * - get_dataset: get full metadata for a dataset by ID
 */


const BASE = 'https://healthdata.gov/api/3';

// ── Helpers ───────────────────────────────────────────────────────────

async function hdGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HealthData.gov API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { success: boolean; result: unknown; error?: { message: string } };
  if (!data.success) {
    throw new Error(`HealthData.gov error: ${data.error?.message ?? 'Unknown error'}`);
  }

  return data.result;
}

// ── Tool definitions ──────────────────────────────────────────────────

const tools: McpToolExport['tools'] = [
  {
    name: 'search_datasets',
    description:
      'Search HealthData.gov for public health datasets by keyword (e.g., "COVID hospitalizations", "Medicare spending", "opioid prescriptions"). Returns dataset titles, descriptions, organizations, and resource links.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "vaccination rates", "hospital readmissions", "air quality health")',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (1-50, default 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_dataset',
    description:
      'Get full metadata for a HealthData.gov dataset by its package ID. Returns title, description, organization, resources (CSV/JSON download links), update frequency, and tags.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Dataset package ID (returned by search_datasets)',
        },
      },
      required: ['id'],
    },
  },
];

// ── callTool dispatcher ───────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_datasets':
      return searchDatasets(args.query as string, (args.limit as number) ?? 10);
    case 'get_dataset':
      return getDataset(args.id as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Tool implementations ─────────────────────────────────────────────

type CkanResource = {
  id: string;
  name: string;
  format: string;
  url: string;
  description: string;
  created: string;
  last_modified: string;
};

type CkanPackage = {
  id: string;
  name: string;
  title: string;
  notes: string;
  organization: { title: string; name: string };
  metadata_created: string;
  metadata_modified: string;
  tags: Array<{ name: string }>;
  resources: CkanResource[];
  license_title: string;
  num_resources: number;
};

async function searchDatasets(query: string, limit: number) {
  const safeLimit = Math.min(50, Math.max(1, limit));

  const result = (await hdGet('/action/package_search', {
    q: query,
    rows: String(safeLimit),
  })) as {
    count: number;
    results: CkanPackage[];
  };

  return {
    total: result.count,
    results: (result.results ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      title: d.title ?? null,
      description: d.notes ? d.notes.slice(0, 300) : null,
      organization: d.organization?.title ?? null,
      created: d.metadata_created ?? null,
      modified: d.metadata_modified ?? null,
      tags: (d.tags ?? []).map((t) => t.name),
      num_resources: d.num_resources ?? 0,
      resource_formats: (d.resources ?? []).map((r) => r.format).filter(Boolean),
    })),
  };
}

async function getDataset(id: string) {
  const d = (await hdGet('/action/package_show', { id })) as CkanPackage;

  return {
    id: d.id,
    name: d.name,
    title: d.title ?? null,
    description: d.notes ?? null,
    organization: d.organization?.title ?? null,
    license: d.license_title ?? null,
    created: d.metadata_created ?? null,
    modified: d.metadata_modified ?? null,
    tags: (d.tags ?? []).map((t) => t.name),
    resources: (d.resources ?? []).map((r) => ({
      id: r.id,
      name: r.name ?? null,
      format: r.format ?? null,
      url: r.url ?? null,
      description: r.description ?? null,
      created: r.created ?? null,
      last_modified: r.last_modified ?? null,
    })),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
