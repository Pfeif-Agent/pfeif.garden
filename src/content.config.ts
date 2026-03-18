import { defineCollection } from 'astro:content';
import { z } from 'zod';

const writing = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),

    // Organization
    type: z.enum(['essay', 'note', 'playlist', 'art', 'video', 'other']).default('essay'),
    tags: z.array(z.string()).default([]),
    series: z.string().optional(),

    // Display
    growthStage: z.enum(['draft', 'active', 'complete']).default('draft'),
    highlight: z.boolean().default(false),
    draft: z.boolean().default(false),
    coverImage: z.string().optional(),

    // Syndication
    atprotoUri: z.string().optional(),
  }),
});

const lab = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),

    // Organization
    type: z.enum(['app', 'playlist', 'art', 'video', 'experiment', 'other']).default('experiment'),
    tags: z.array(z.string()).default([]),

    // Media
    coverImage: z.string().optional(),

    // Links
    externalUrl: z.string().url().optional(),

    // Display
    growthStage: z.enum(['draft', 'active', 'complete']).default('draft'),
    highlight: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing, lab };
