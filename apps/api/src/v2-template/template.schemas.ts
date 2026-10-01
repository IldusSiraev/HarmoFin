import { z } from 'zod';

export const uuidParamSchema = z.string().uuid();
