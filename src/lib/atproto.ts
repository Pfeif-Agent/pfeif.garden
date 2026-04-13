/**
 * Fetch site.standard.document records from the ATProto PDS at build time.
 */

const DID = 'did:plc:qpqndv7eygmebyqbguc345nk';
const PDS = 'https://lionsmane.us-east.host.bsky.network';

export interface AtprotoPost {
  uri: string;
  slug: string;
  title: string;
  description: string;
  publishDate: Date;
  updatedDate?: Date;
  tags: string[];
  markdown: string;
  path: string;
}

interface DocumentRecord {
  $type: 'site.standard.document';
  title: string;
  description?: string;
  publishedAt: string;
  updatedAt?: string;
  tags?: string[];
  path?: string;
  content?: {
    $type: 'at.markpub.markdown';
    text?: {
      $type: 'at.markpub.text';
      markdown: string;
    };
  };
}

export async function getAtprotoPosts(): Promise<AtprotoPost[]> {
  const url = `${PDS}/xrpc/com.atproto.repo.listRecords?repo=${DID}&collection=site.standard.document&limit=100`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.warn('[atproto] Failed to fetch records:', e);
    return [];
  }

  if (!res.ok) {
    console.warn('[atproto] listRecords returned', res.status);
    return [];
  }

  const json = await res.json();
  const records: AtprotoPost[] = [];

  for (const { uri, value } of json.records ?? []) {
    const rec = value as DocumentRecord;
    if (rec.$type !== 'site.standard.document') continue;
    if (!rec.title || !rec.publishedAt) continue;

    const markdown = rec.content?.text?.markdown ?? '';
    const rawPath = rec.path ?? '';
    // derive slug from path (/my-post → my-post) or from the rkey
    const slug = rawPath.replace(/^\//, '') || uri.split('/').pop() || '';

    records.push({
      uri,
      slug,
      title: rec.title,
      description: rec.description ?? '',
      publishDate: new Date(rec.publishedAt),
      updatedDate: rec.updatedAt ? new Date(rec.updatedAt) : undefined,
      tags: rec.tags ?? [],
      markdown,
      path: rawPath || `/${slug}`,
    });
  }

  // newest first
  return records.sort((a, b) => b.publishDate.valueOf() - a.publishDate.valueOf());
}
