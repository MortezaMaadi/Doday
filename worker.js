import { neon } from "@neondatabase/serverless";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // تست وضعیت متغیرهای محیطی
    if (url.pathname === "/api/test-env") {
      return Response.json({
        hasDatabaseUrl: !!env.DATABASE_URL,
        hasNeon: !!env.neon
      });
    }

    // شناسه کاربر از درخواست
    const userId = url.searchParams.get("user");

    // API: دریافت داده
    if (url.pathname === "/api/data" && request.method === "GET") {
      try {
        if (!userId) {
          return Response.json(
            { error: "Missing user" },
            { status: 400 }
          );
        }

        const sql = neon(env.DATABASE_URL);

        const rows = await sql`
          SELECT data, updated_at
          FROM doday_data
          WHERE id = ${userId}
          LIMIT 1
        `;

        if (rows.length === 0) {
          return Response.json({
            data: null,
            updated_at: null
          });
        }

        return Response.json(rows[0]);

      } catch (error) {
        console.error(error);

        return Response.json(
          {
            error: "Database error",
            detail: error?.message || String(error)
          },
          { status: 500 }
        );
      }
    }

    // API: ذخیره داده
    if (url.pathname === "/api/data" && request.method === "PUT") {
      try {
        if (!userId) {
          return Response.json(
            { error: "Missing user" },
            { status: 400 }
          );
        }

        const body = await request.json();

        if (!body || typeof body.data !== "object") {
          return Response.json(
            { error: "Invalid data" },
            { status: 400 }
          );
        }

        const sql = neon(env.DATABASE_URL);

        const rows = await sql`
          INSERT INTO doday_data (id, data, updated_at)
          VALUES (
            ${userId},
            ${JSON.stringify(body.data)}::jsonb,
            NOW()
          )
          ON CONFLICT (id)
          DO UPDATE SET
            data = EXCLUDED.data,
            updated_at = NOW()
          RETURNING data, updated_at
        `;

        return Response.json(rows[0]);

      } catch (error) {
        console.error(error);

        return Response.json(
          {
            error: "Database error",
            detail: error?.message || String(error)
          },
          { status: 500 }
        );
      }
    }

    // بقیه درخواست‌ها → فایل‌های Doday
    return env.ASSETS.fetch(request);
  }
};
