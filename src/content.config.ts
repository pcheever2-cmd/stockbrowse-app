import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Stockbrowse Team'),
    category: z.enum([
      'getting-started',
      'your-money',
      'investing-basics',
      'stock-discovery',
      'industry-guides',
    ]).default('getting-started'),
  }),
});

export const collections = { blog };
