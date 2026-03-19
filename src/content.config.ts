import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    type: z.enum(['essay', 'note', 'playlist', 'art', 'video', 'other']).default('essay'),
    tags: z.array(z.string()).default([]),
    series: z.string().optional(),
    growthStage: z.enum(['draft', 'active', 'complete']).default('draft'),
    highlight: z.boolean().default(false),
    draft: z.boolean().default(false),
    coverImage: z.string().optional(),
    atprotoUri: z.string().optional(),
  }),
});

const lab = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/lab' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    type: z.enum(['app', 'playlist', 'art', 'video', 'experiment', 'other']).default('experiment'),
    tags: z.array(z.string()).default([]),
    coverImage: z.string().optional(),
    externalUrl: z.string().url().optional(),
    growthStage: z.enum(['draft', 'active', 'complete']).default('draft'),
    highlight: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing, lab };
