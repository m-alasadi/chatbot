import { NextResponse, type NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  // عند زيارة الجذر "/" → إعادة توجيه لـ /ar
  if (request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/ar", request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: "/((?!api|static|.*\\..*|_next).*)"
}
