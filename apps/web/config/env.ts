import { z } from 'zod';

const webEnvironmentSchema = z.object({
  WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  API_URL: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
      message: 'must be an HTTP(S) URL',
    })
    .default('http://localhost:3001'),
});

export interface WebConfig {
  webPort: number;
  apiUrl: string;
}

export function loadWebConfig(input: NodeJS.ProcessEnv): WebConfig {
  const result = webEnvironmentSchema.safeParse(input);

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(
      ', ',
    );
    throw new Error(`Invalid web configuration: ${fields}`);
  }

  return {
    webPort: result.data.WEB_PORT,
    apiUrl: result.data.API_URL,
  };
}
