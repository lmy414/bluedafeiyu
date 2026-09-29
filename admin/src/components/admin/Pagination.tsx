import React from 'react'

export function Pagination({
  page,
  setPage,
  totalPages,
}: {
  page: number
  setPage: (page: number) => void
  totalPages: number
}) {
  if (totalPages <= 1) return null
  return (
    <nav aria-label="分页" className="s3-pagination">
      <button disabled={page <= 1} onClick={() => setPage(Math.max(1, page - 1))} type="button">
        上一页
      </button>
      <span>
        第 {page} / {totalPages} 页
      </span>
      <button disabled={page >= totalPages} onClick={() => setPage(Math.min(totalPages, page + 1))} type="button">
        下一页
      </button>
    </nav>
  )
}
