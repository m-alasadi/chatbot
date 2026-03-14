/**
 * Widget.js Endpoint
 * يُرجع السكريبت الكامل للودجت (standalone bundle)
 * CSS مدمج داخل JS - لا يوجد ملفات خارجية
 */

import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    // قراءة widget.js من public
    const widgetPath = join(process.cwd(), 'public', 'widget.js')
    const widgetContent = await readFile(widgetPath, 'utf-8')

    return new NextResponse(widgetContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    })
  } catch (error) {
    console.error('[Widget Endpoint] Error:', error)
    
    return new NextResponse(
      `console.error('[AlKafeel Widget] Failed to load: ${error}');`,
      {
        status: 500,
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
        },
      }
    )
  }
}

// CORS Preflight
export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}
