export function GET() {
  return new Response(null, {
    headers: { Location: '/admin' },
    status: 307,
  })
}
