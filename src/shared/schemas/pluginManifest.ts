import { z } from 'zod';

export const PluginCategorySchema = z.enum(['code', 'text', 'image', 'system', 'vibe', 'tools', 'dev']);

export const PermissionTypeSchema = z.enum([
  'clipboard',
  'file-read',
  'file-write',
  'lan',
  'network',
  'input',
]);

export const PluginManifestSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Plugin ID must be alphanumeric with dots/hyphens'),
  name: z.string().min(1).max(100),
  desc: z.string().min(1).max(500),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must be semver (e.g., 1.0.0)'),
  author: z.string().min(1).max(100),
  icon: z.string().default('assets/icon.svg'),
  keywords: z.array(z.string()).min(1).max(20),
  category: PluginCategorySchema,
  permissions: z.array(PermissionTypeSchema).default([]),
  minAppVersion: z.string().optional(),
  windowWidth: z.number().int().min(300).max(1600).optional(),
  windowHeight: z.number().int().min(200).max(1200).optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
