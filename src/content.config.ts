import { defineCollection } from 'astro:content';
import { z } from 'zod';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),

    // Organization
    tags: z.array(z.string()).default([]),
    series: z.string().optional(),       // e.g. "Building Loam"
    collection: z.string().optional(),   // broader grouping if needed

    // Display
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    coverImage: z.string().optional(),   // path or URL — used for OG/social cards

    // Syndication
    atprotoUri: z.string().optional(),   // AT URI after crossposting to Bluesky
  }),
});

const portfolio = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),           // short tagline for cards
    year: z.number().optional(),

    // Media
    coverImage: z.string().optional(), // hero image for the card/page
    images: z.array(z.string()).default([]),

    // Links
    url: z.url().optional(),
    repo: z.url().optional(),

    // Organization
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, portfolio };
