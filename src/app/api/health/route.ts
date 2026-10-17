import { connection } from "next/server";

// Runs at request time, so a 200 here means deployed functions are working.
export async function GET() {
  await connection();
  return Response.json({
    ok: true,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    time: new Date().toISOString(),
  });
}
