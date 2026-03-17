import { getRawProjectsForContentLayer } from "../../server/site-api-service"

export async function fetchRawProjects(): Promise<any[]> {
  return getRawProjectsForContentLayer()
}
