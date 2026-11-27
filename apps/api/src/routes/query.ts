import { z } from 'zod';
import { ApiError } from '../errors.js';

const pageNumber = z.coerce.number().int().min(1).max(100_000);

export function pagination(query: Record<string, string>, defaultSize = 30, maxSize = 100) {
  const parsed = z.object({ page: pageNumber.default(1), pageSize: z.coerce.number().int().min(1).max(maxSize).default(defaultSize) })
    .safeParse({ page: query.page, pageSize: query.pageSize ?? query.limit });
  if (!parsed.success) throw new ApiError(400, 'invalid_pagination', '分页参数无效', parsed.error.issues);
  const { page, pageSize } = parsed.data;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasMore = page < totalPages;
  return { items, total, page, pageSize, totalPages, hasMore, nextPage: hasMore ? page + 1 : null };
}

export const likePattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
